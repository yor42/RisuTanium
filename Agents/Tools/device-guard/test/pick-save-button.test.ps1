# Fake-adb cases for adbg r18 `pick --id android:id/button1` (CHORE-227 D1 save rows): the Save button of the system save picker is the
# one non-documentsui id pick --id accepts, only with the filename field (resource-id android:id/title, class EditText) in the same dump.
# Usage: pwsh -File pick-save-button.test.ps1 -GuardPath <adbg.mjs>
param([Parameter(Mandatory = $true)][string]$GuardPath)
$testDir = Join-Path ([IO.Path]::GetTempPath()) ('adbg-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testDir | Out-Null
$fake = Join-Path $testDir 'fake.mjs'
$calls = Join-Path $testDir 'calls.txt'
# The fake adb records every call as one JSON array. FAKE_PIDS maps a package to its pid (a missing package makes pidof exit 1),
# FAKE_ADJ maps a pid to its oom_score_adj (a missing pid reads 900). For the pick device command it follows the guard's own script:
# an optional `grep -q '<proof>'` over the fixture decides between the bounds grep and the ADBG-NO-SAVE-FIELD marker; the bounds grep
# runs as a JS RegExp, keeps the first two hits (head -n 2) and prints only their bounds; then ADBG-DUMP=0. A pattern outside the BRE
# subset the guard uses makes it print FAKE-UNSUPPORTED and exit 1, so no row can pass on a mis-emulated pattern.
$fakeSource = @'
import { appendFileSync, readFileSync } from "node:fs"
const a = process.argv.slice(2)
appendFileSync(process.env.FAKE_CALLS, JSON.stringify(a) + "\n")
const j = a.slice(2).join(" ")
const pids = JSON.parse(process.env.FAKE_PIDS ?? "{}")
const adj = JSON.parse(process.env.FAKE_ADJ ?? "{}")
const supported = (pat) => /^[A-Za-z0-9_:\/="\- ,.]*$/.test(pat.replace(/\[\^>\]|\[0-9\]|\\\.|\\\[|\\\]|\*/g, ""))
let m
if ((m = j.match(/^shell pidof (\S+)$/))) { if (pids[m[1]] === undefined) process.exit(1); process.stdout.write(String(pids[m[1]])) }
else if ((m = j.match(/^shell cat \/proc\/(\d+)\/oom_score_adj$/))) process.stdout.write(String(adj[m[1]] ?? 900))
else if (a[2] === "shell" && /^uiautomator dump /.test(a[3] ?? "") && a[3].includes("ADBG-DUMP")) {
  const xml = readFileSync(process.env.FAKE_DUMP, "utf8")
  let out = ""
  const q = a[3].match(/grep -q '([^']*)'/)
  const pat = a[3].match(/grep -o '([^']*)'/)[1]
  if (!supported(pat) || (q && !supported(q[1]))) { process.stdout.write("FAKE-UNSUPPORTED\n"); process.exit(1) }
  if (q && !new RegExp(q[1]).test(xml)) out = "ADBG-NO-SAVE-FIELD\n"
  else for (const h of (xml.match(new RegExp(pat, "g")) ?? []).slice(0, 2)) out += h.match(/bounds="[^"]*"/)[0] + "\n"
  process.stdout.write(out + "ADBG-DUMP=0\n")
}
process.exit(0)
'@
Set-Content $fake $fakeSource
$env:ADBG_FAKE_ADB_SCRIPT = $fake
$env:FAKE_CALLS = $calls
# Every guard spawn goes through the stand-in adb; never run a case where it is not in place.
if (-not $env:ADBG_FAKE_ADB_SCRIPT -or -not (Test-Path -LiteralPath $env:ADBG_FAKE_ADB_SCRIPT)) { throw 'ADBG_FAKE_ADB_SCRIPT is not set to an existing fake: refusing to run' }
$log = Join-Path $testDir 'log.txt'
$st = Join-Path $testDir 'state.json'
$script:failures = 0
$pg = @('29f3cde9193f7ece', '2ac80128013f7ece')
$dui = 'com.android.documentsui'
$btn = 'android:id/button1'
$okId = 'com.android.documentsui:id/action_menu_select'
function Test-Result([string]$label, [bool]$pass, [string]$detail) {
    if (-not $pass) { $script:failures++ }
    ($(if ($pass) { 'ok  ' } else { 'FAIL' })) + ' ' + $label + ' ' + $detail
}
function Get-Calls { if (Test-Path $calls) { , @(Get-Content $calls) } else { , @() } }
function Reset-Run { if (Test-Path $calls) { Remove-Item $calls }; Remove-Item $log -ErrorAction SilentlyContinue; Remove-Item $st -ErrorAction SilentlyContinue }
function Get-LogText { if (Test-Path $log) { Get-Content $log -Raw } else { '' } }
function Get-State { if (Test-Path $st) { Get-Content $st -Raw | ConvertFrom-Json } else { $null } }
function Test-Locked { $s = Get-State; [bool]($s -and $s.pickLocked) }
function Get-PickErrors { $s = Get-State; if ($s) { [int]$s.pickErrors } else { 0 } }
function ConvertTo-Json1($value) { ConvertTo-Json -Compress -InputObject $value }

# ---- fixtures, shaped like the uiautomator dump: one line, nested parent, self-closing leaves, the dumper's attribute order ----
function New-Leaf([string]$text, [string]$rid, [string]$cls, [string]$bounds) {
    '<node index="0" text="' + $text + '" resource-id="' + $rid + '" class="' + $cls + '" package="com.android.documentsui" content-desc="" checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="' + $bounds + '" />'
}
function Write-Fixture([string]$name, [string[]]$leaves) {
    $path = Join-Path $testDir ($name + '.xml')
    $parent = '<node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.android.documentsui" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,0][1440,2960]">'
    $xml = "<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation=""0"">" + $parent + ($leaves -join '') + '</node></hierarchy>'
    [IO.File]::WriteAllText($path, $xml, (New-Object System.Text.UTF8Encoding($false)))
    $path
}
$btnBounds = '[800,2700][1400,2850]'
$leafSave = New-Leaf 'Save' $btn 'android.widget.Button' $btnBounds
$leafField = New-Leaf 'notes.bin' 'android:id/title' 'android.widget.EditText' '[100,300][1300,420]'
$leafFieldView = New-Leaf 'notes.bin' 'android:id/title' 'android.widget.TextView' '[100,300][1300,420]'
$leafFieldOtherId = New-Leaf 'notes.bin' 'android:id/text1' 'android.widget.EditText' '[100,300][1300,420]'
$leafFieldLongId = New-Leaf 'notes.bin' 'android:id/title_extra' 'android.widget.EditText' '[100,300][1300,420]'
$leafCancel = New-Leaf 'Cancel' 'android:id/button2' 'android.widget.Button' '[100,2700][700,2850]'
$leafBtn10 = New-Leaf 'X' 'android:id/button10' 'android.widget.Button' '[2,2][12,12]'
$leafSel = New-Leaf 'OK' $okId 'android.widget.Button' '[1200,84][1420,252]'
$fxSave = Write-Fixture 'save' @($leafField, $leafSave, $leafCancel, $leafBtn10)
$fxReplace = Write-Fixture 'replace' @($leafCancel, $leafSave)
$fxFieldView = Write-Fixture 'fieldview' @($leafCancel, $leafSave, $leafFieldView)
$fxOtherId = Write-Fixture 'otherid' @($leafSave, $leafFieldOtherId)
$fxLongId = Write-Fixture 'longid' @($leafSave, $leafFieldLongId)
$fxNoButton = Write-Fixture 'nobutton' @($leafField, $leafCancel)
$fxSelect = Write-Fixture 'select' @($leafSel, $leafSave)

function Invoke-Pick([string]$ser, [string[]]$pickArgs, [hashtable]$pids, [hashtable]$adjs, [string]$fx) {
    Reset-Run
    $env:FAKE_PIDS = ConvertTo-Json1 $pids
    $env:FAKE_ADJ = ConvertTo-Json1 $adjs
    $env:FAKE_DUMP = $fx
    $out = (& node $GuardPath pick --serial $ser --log $log --state $st @pickArgs 2>$null) -join "`n"
    [pscustomobject]@{ rc = [string]$LASTEXITCODE; out = $out }
}
$frontDui = @{ $dui = 5151 }
$adjDui = @{ '5151' = 0 }
function Test-Dumped { (((Get-Calls) -join ' ').Contains('uiautomator dump')) }

foreach ($s in $pg) {
    # SB-1: button1 with the picker in front and the filename field in the dump is located, then the ordinary tap fires at its centre.
    $r = Invoke-Pick $s @('--id', $btn) $frontDui $adjDui $fxSave
    $st1 = Get-State
    $script1 = if ((Get-Calls).Count -ge 3) { ((Get-Calls)[2] | ConvertFrom-Json)[3] } else { '' }
    Test-Result ($s + ' SB-1 button1 with the save field: match') ($r.rc -eq '0' -and $r.out -eq ('match bounds=' + $btnBounds) -and $st1.locates[0].label -eq ('pick-id:' + $btn) -and -not (Test-Locked) -and (Get-LogText).Contains('pick --id android:id/button1 (save confirm, r18)') -and (Get-LogText).Contains('front=' + $dui)) ('-> ' + $r.rc + ' ' + $r.out)
    Test-Result ($s + ' SB-1 one dump command that removes its dump') ((Get-Calls).Count -eq 3 -and $script1.Contains('rm -f /sdcard/adbg-pick-') -and $script1.Contains('ADBG-NO-SAVE-FIELD')) ('-> calls=' + (Get-Calls).Count)
    if (Test-Path $calls) { Remove-Item $calls }
    & node $GuardPath tap --serial $s --log $log --state $st --max-age 10 2>$null | Out-Null
    $tapRc = [string]$LASTEXITCODE
    $got = Get-Calls
    Test-Result ($s + ' SB-1 tap issued at the button centre') ($tapRc -eq '0' -and $got.Count -eq 1 -and $got[0] -eq ('["-s","' + $s + '","shell","input","tap","1100","2775"]')) ('-> ' + $tapRc + ' calls=' + ($got -join ' | '))
}

# SB-2: button1 present but no filename field node (a replace dialog): refused after the dump, no locate, no tap, a pick error and no lock.
foreach ($c in @(
        @{ n = 'no field node at all'; fx = $fxReplace },
        @{ n = 'field id with another class'; fx = $fxFieldView },
        @{ n = 'EditText with another resource-id'; fx = $fxOtherId },
        @{ n = 'EditText with a longer title id'; fx = $fxLongId })) {
    $r = Invoke-Pick $pg[0] @('--id', $btn) $frontDui $adjDui $c.fx
    $s2 = Get-State
    Test-Result ('SB-2 ' + $c.n) ($r.rc -eq '4' -and $r.out -eq '' -and (Test-Dumped) -and -not (Test-Locked) -and (Get-PickErrors) -eq 1 -and @($s2.locates).Count -eq 0 -and (Get-Calls).Count -eq 3) ('-> ' + $r.rc + ' errors=' + (Get-PickErrors) + ' calls=' + (Get-Calls).Count)
}
# SB-2b: the field is there but the button is not: an ordinary no-match (lock), as for any id.
$r = Invoke-Pick $pg[0] @('--id', $btn) $frontDui $adjDui $fxNoButton
Test-Result 'SB-2b field without button1 is a no-match' ($r.rc -eq '3' -and $r.out -eq 'no-match' -and (Test-Locked)) ('-> ' + $r.rc + ' ' + $r.out)
# SB-2c: a refusal counts toward the two-error cap and sets no lock; the third pick is refused (98) with no adb call.
$null = Invoke-Pick $pg[0] @('--id', $btn) $frontDui $adjDui $fxReplace
if (Test-Path $calls) { Remove-Item $calls }
$null = & node $GuardPath pick --serial $pg[0] --log $log --state $st --id $btn 2>$null
if (Test-Path $calls) { Remove-Item $calls }
$null = & node $GuardPath pick --serial $pg[0] --log $log --state $st --id $okId 2>$null
Test-Result 'SB-2c two refusals reach the cap' ($LASTEXITCODE -eq 98 -and (Get-Calls).Count -eq 0 -and -not (Test-Locked)) ('-> ' + $LASTEXITCODE)

# SB-3: no system file picker in front: 93, no dump, one pick error, no lock.
$r = Invoke-Pick $pg[1] @('--id', $btn) @{} @{} $fxSave
Test-Result 'SB-3 no picker in front' ($r.rc -eq '93' -and -not (Test-Dumped) -and -not (Test-Locked) -and (Get-PickErrors) -eq 1) ('-> ' + $r.rc + ' calls=' + (Get-Calls).Count)
$r = Invoke-Pick $pg[1] @('--id', $btn) @{ $dui = 5151 } @{ '5151' = 100 } $fxSave
Test-Result 'SB-3 picker in the background' ($r.rc -eq '93' -and -not (Test-Dumped)) ('-> ' + $r.rc)

# SB-4: restricted serials 95 and emulator-5580 97, no adb call.
foreach ($s in @('R58M12345AB', '2ac80128013f7ecf')) {
    $r = Invoke-Pick $s @('--id', $btn) $frontDui $adjDui $fxSave
    Test-Result ('SB-4 ' + $s) ($r.rc -eq '95' -and (Get-Calls).Count -eq 0) ('-> ' + $r.rc + ' calls=' + (Get-Calls).Count)
}
$r = Invoke-Pick 'emulator-5580' @('--id', $btn) $frontDui $adjDui $fxSave
Test-Result 'SB-4 emulator-5580' ($r.rc -eq '97' -and (Get-Calls).Count -eq 0) ('-> ' + $r.rc + ' calls=' + (Get-Calls).Count)

# SB-5: every other android:id/* and near-misses are refused with exit 2, no adb call and no state change.
$refused = [ordered]@{
    'button2'            = 'android:id/button2'
    'button10'           = 'android:id/button10'
    'button1x'           = 'android:id/button1x'
    'button3'            = 'android:id/button3'
    'title'              = 'android:id/title'
    'content'            = 'android:id/content'
    'button1 upper'      = 'android:id/Button1'
    'button1 prefixed'   = 'xandroid:id/button1'
    'button1 pkg case'   = 'ANDROID:id/button1'
    'button1 slash tail' = 'android:id/button1/'
    'button1 blank tail' = 'android:id/button1 '
    'button1 quote tail' = 'android:id/button1"'
    'button1 dotdot'     = 'android:id/button1/..'
    'button1 glob'       = 'android:id/button*'
    'button1 dot'        = 'android:id/button.'
    'google button1'     = 'com.google.android.documentsui:id/button1'
    'app button1'        = 'io.github.yor42.risutanium:id/button1'
}
foreach ($k in $refused.Keys) {
    $r = Invoke-Pick $pg[1] @('--id', $refused[$k]) $frontDui $adjDui $fxSave
    $s5 = Get-State
    $quiet = (-not $s5) -or (-not $s5.pickLocked -and [int]$s5.pickErrors -eq 0)
    Test-Result ('SB-5 refuses ' + $k) ($r.rc -eq '2' -and (Get-Calls).Count -eq 0 -and $quiet) ('-> ' + $r.rc + ' calls=' + (Get-Calls).Count)
}
# SB-5b: the option walk is as strict as for the documentsui ids.
foreach ($c in @(@('--id', $btn, '--name', 'notes.bin'), @('--id', $btn, '--id', $btn), @('--id', $btn, 'extra'), @('--id', $btn, '--', 'shell', 'ls'))) {
    $r = Invoke-Pick $pg[1] $c $frontDui $adjDui $fxSave
    Test-Result ('SB-5b strict options ' + ($c -join ' ')) ($r.rc -eq '2' -and (Get-Calls).Count -eq 0) ('-> ' + $r.rc)
}

# SB-6: unchanged documentsui ids need no filename field and their device command carries no proof grep.
$r = Invoke-Pick $pg[0] @('--id', $okId) $frontDui $adjDui $fxSelect
$scriptOk = if ((Get-Calls).Count -ge 3) { ((Get-Calls)[2] | ConvertFrom-Json)[3] } else { '' }
Test-Result 'SB-6 documentsui id still matches without a save field' ($r.rc -eq '0' -and $r.out -eq 'match bounds=[1200,84][1420,252]' -and -not $scriptOk.Contains('grep -q') -and -not $scriptOk.Contains('ADBG-NO-SAVE-FIELD')) ('-> ' + $r.rc + ' ' + $r.out)
$r = Invoke-Pick $pg[0] @('--name', 'notes.bin') @{} @{} $fxSave
Test-Result 'SB-6 --name form unchanged (no front check, one call)' ($r.rc -eq '0' -and $r.out -eq 'match bounds=[100,300][1300,420]' -and (Get-Calls).Count -eq 1) ('-> ' + $r.rc + ' calls=' + (Get-Calls).Count)
$null = Invoke-Pick $pg[0] @('--id', 'com.android.documentsui:id/title') $frontDui $adjDui $fxSave
Test-Result 'SB-6 documentsui no-match still locks' (Test-Locked) ''

foreach ($v in @('ADBG_FAKE_ADB_SCRIPT', 'FAKE_CALLS', 'FAKE_PIDS', 'FAKE_ADJ', 'FAKE_DUMP', 'FAKE_DUMP_EXIT')) { Remove-Item Env:$v -ErrorAction SilentlyContinue }
Remove-Item -LiteralPath $testDir -Recurse -Force -ErrorAction SilentlyContinue
'failures=' + $script:failures
exit $script:failures
