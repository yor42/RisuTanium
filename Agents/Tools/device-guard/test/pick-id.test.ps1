# Fake-adb cases for adbg `pick --id <resource-id>` (MC-2303, MC-2306, CHORE-850): the exact com.android.documentsui id form of
# the pick helper, its front-picker gate, its shared lock and error cap, the unchanged `pick --name` form, and the README rm claim.
# Usage: pwsh -File pick-id.test.ps1 -GuardPath <adbg.mjs>
param([Parameter(Mandatory = $true)][string]$GuardPath)
$testDir = Join-Path ([IO.Path]::GetTempPath()) ('adbg-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testDir | Out-Null
$fake = Join-Path $testDir 'fake.mjs'
$calls = Join-Path $testDir 'calls.txt'
# The fake adb records every call as one JSON array. FAKE_PIDS maps a package to its pid (a missing package makes pidof exit 1),
# FAKE_ADJ maps a pid to its oom_score_adj (a missing pid reads 900). For the pick device command it runs the guard's own grep
# pattern as a JS RegExp over the fixture named by FAKE_DUMP, keeps the first two hits (head -n 2) and prints only their bounds,
# then ADBG-DUMP=<FAKE_DUMP_EXIT>. A pattern outside the BRE subset the guard uses makes it print FAKE-UNSUPPORTED and exit 1,
# so no row can pass on a mis-emulated pattern.
$fakeSource = @'
import { appendFileSync, readFileSync } from "node:fs"
const a = process.argv.slice(2)
appendFileSync(process.env.FAKE_CALLS, JSON.stringify(a) + "\n")
const j = a.slice(2).join(" ")
const pids = JSON.parse(process.env.FAKE_PIDS ?? "{}")
const adj = JSON.parse(process.env.FAKE_ADJ ?? "{}")
let m
if ((m = j.match(/^shell pidof (\S+)$/))) { if (pids[m[1]] === undefined) process.exit(1); process.stdout.write(String(pids[m[1]])) }
else if ((m = j.match(/^shell cat \/proc\/(\d+)\/oom_score_adj$/))) process.stdout.write(String(adj[m[1]] ?? 900))
else if (a[2] === "shell" && /^uiautomator dump /.test(a[3] ?? "") && a[3].includes("ADBG-DUMP")) {
  const ex = Number(process.env.FAKE_DUMP_EXIT ?? "0")
  let out = ""
  if (ex === 0) {
    const pat = a[3].match(/grep -o '([^']*)'/)[1]
    if (!/^[A-Za-z0-9_:\/="\- ,]*$/.test(pat.replace(/\[\^>\]|\[0-9\]|\\\.|\\\[|\\\]|\*/g, ""))) { process.stdout.write("FAKE-UNSUPPORTED\n"); process.exit(1) }
    const xml = readFileSync(process.env.FAKE_DUMP, "utf8")
    for (const h of (xml.match(new RegExp(pat, "g")) ?? []).slice(0, 2)) out += h.match(/bounds="[^"]*"/)[0] + "\n"
  }
  process.stdout.write(out + "ADBG-DUMP=" + ex + "\n")
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
$pkg = 'io.github.yor42.risutanium'
$dui = 'com.android.documentsui'
$gdui = 'com.google.android.documentsui'
$ok = 'com.android.documentsui:id/action_menu_select'
$expectBounds = '[1200,84][1420,252]'
function Test-Result([string]$label, [bool]$pass, [string]$detail) {
    if (-not $pass) { $script:failures++ }
    ($(if ($pass) { 'ok  ' } else { 'FAIL' })) + ' ' + $label + ' ' + $detail
}
# The leading comma keeps a single call an array, so indexing and Count behave the same for one call as for several.
function Get-Calls { if (Test-Path $calls) { , @(Get-Content $calls) } else { , @() } }
function Reset-Calls { if (Test-Path $calls) { Remove-Item $calls } }
function Get-LogText { if (Test-Path $log) { Get-Content $log -Raw } else { '' } }
function Get-State { if (Test-Path $st) { Get-Content $st -Raw | ConvertFrom-Json } else { $null } }
function Test-Locked { $s = Get-State; [bool]($s -and $s.pickLocked) }
function Get-PickErrors { $s = Get-State; if ($s) { [int]$s.pickErrors } else { 0 } }
function ConvertTo-Json1($value) { ConvertTo-Json -Compress -InputObject $value }
function Get-Pidof([string]$ser, [string]$p) { '["-s","' + $ser + '","shell","pidof ' + $p + '"]' }
function Get-Adj([string]$ser, [string]$n) { '["-s","' + $ser + '","shell","cat /proc/' + $n + '/oom_score_adj"]' }
function Reset-Run { Reset-Calls; Remove-Item $log -ErrorAction SilentlyContinue; Remove-Item $st -ErrorAction SilentlyContinue }

# ---- fixtures, shaped like the uiautomator dump: one line, no BOM, nested parents, self-closing leaves, the dumper's attribute order ----
$sun = [string][char]0xC120 + [string][char]0xD0DD
function New-Leaf([string]$text, [string]$rid, [string]$bounds) {
    '<node index="0" text="' + $text + '" resource-id="' + $rid + '" class="android.widget.Button" package="com.android.documentsui" content-desc="' + $text + '" checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="' + $bounds + '" />'
}
function Write-Fixture([string]$name, [string[]]$leaves) {
    $path = Join-Path $testDir ($name + '.xml')
    $parent = '<node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.android.documentsui" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,0][1440,2960]">'
    $xml = "<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation=""0"">" + $parent + ($leaves -join '') + '</node></hierarchy>'
    [IO.File]::WriteAllText($path, $xml, (New-Object System.Text.UTF8Encoding($false)))
    $path
}
$pre = 'com.android.documentsui:id/'
$leafSel = New-Leaf $sun $ok $expectBounds
$leafTitle = New-Leaf 'Recent' 'android:id/title' '[0,300][700,400]'
$leafCard = New-Leaf 'c850-card.png' 'com.android.documentsui:id/title' '[200,400][1200,480]'
$leafAll = New-Leaf $sun ($ok + '_all') '[1000,84][1180,252]'
$leafX = New-Leaf $sun ($ok + '_x') '[800,84][980,252]'
$fxSel = Write-Fixture 'sel' @($leafSel, $leafTitle, $leafCard)
$fxSib = Write-Fixture 'sib' @($leafAll, $leafX, $leafTitle)
$fxSib1 = Write-Fixture 'sib1' @($leafAll, $leafTitle)
$fxSibPlus = Write-Fixture 'sibplus' @($leafAll, $leafSel, $leafX, $leafTitle)
$fxTwo = Write-Fixture 'two' @($leafSel, (New-Leaf $sun $ok '[100,84][320,252]'), $leafTitle)
$fxZero = Write-Fixture 'zero' @((New-Leaf $sun $ok '[0,0][0,0]'), $leafTitle)
$fxOther = Write-Fixture 'other' @(
    (New-Leaf $sun 'com.google.android.documentsui:id/action_menu_select' '[1,1][11,11]'),
    (New-Leaf 'OK' 'android:id/button1' '[2,2][12,12]'),
    (New-Leaf $sun 'io.github.yor42.risutanium:id/action_menu_select' '[3,3][13,13]'),
    (New-Leaf $sun 'com.android.documentsuix:id/action_menu_select' '[4,4][14,14]'),
    $leafSel, $leafTitle, $leafCard)

# One guard call of the pick verb; the run state is reset unless -Keep. Returns the exit code and stdout.
function Invoke-Pick([string]$ser, [string[]]$pickArgs, [hashtable]$pids, [hashtable]$adjs, [string]$fx, [string]$dumpExit = '0', [switch]$Keep) {
    if (-not $Keep) { Reset-Run } else { Reset-Calls }
    $env:FAKE_PIDS = ConvertTo-Json1 $pids
    $env:FAKE_ADJ = ConvertTo-Json1 $adjs
    $env:FAKE_DUMP = $fx
    $env:FAKE_DUMP_EXIT = $dumpExit
    $out = (& node $GuardPath pick --serial $ser --log $log --state $st @pickArgs 2>$null) -join "`n"
    [pscustomobject]@{ rc = [string]$LASTEXITCODE; out = $out }
}
$frontDui = @{ $dui = 5151 }
$adjDui = @{ '5151' = 0 }
function Test-Refused2([string]$label, [string[]]$pickArgs) {
    $r = Invoke-Pick $pg[1] $pickArgs $frontDui $adjDui $fxOther
    $s = Get-State
    $quiet = (-not $s) -or (-not $s.pickLocked -and [int]$s.pickErrors -eq 0)
    Test-Result $label ($r.rc -eq '2' -and (Get-Calls).Count -eq 0 -and $quiet) ('-> ' + $r.rc + ' calls=' + (Get-Calls).Count)
}

foreach ($s in $pg) {
    # ID-1: the confirm button is found and then tapped; the call list is exactly the front probe plus the one dump command.
    $r = Invoke-Pick $s @('--id', $ok) $frontDui $adjDui $fxSel
    $got = Get-Calls
    $st1 = Get-State
    Test-Result ($s + ' ID-1 pick --id match') ($r.rc -eq '0' -and $r.out -eq ('match bounds=' + $expectBounds) -and $got.Count -eq 3 -and $got[0] -eq (Get-Pidof $s $dui) -and $got[1] -eq (Get-Adj $s '5151') -and $got[2].Contains('uiautomator dump') -and (Get-LogText).Contains('PLAYGROUND serial=' + $s + ' front=' + $dui + ' (system file picker, pick --id, MC-2303)') -and $st1.locates[0].label -eq ('pick-id:' + $ok) -and -not $st1.locates[0].used) ('-> ' + $r.rc + ' ' + $r.out + ' calls=' + ($got -join ' | '))
    Reset-Calls
    & node $GuardPath tap --serial $s --log $log --state $st --max-age 10 2>$null | Out-Null
    $tapRc = [string]$LASTEXITCODE
    $got = Get-Calls
    Test-Result ($s + ' ID-1 tap consumes the pick-id locate') ($tapRc -eq '0' -and $got.Count -eq 1 -and $got[0] -eq ('["-s","' + $s + '","shell","input","tap","1310","168"]') -and (Get-State).locates[0].used) ('-> ' + $tapRc + ' calls=' + ($got -join ' | '))
}
# ID-2: the Google picker in front; the first picker has no process.
$r = Invoke-Pick $pg[0] @('--id', $ok) @{ $gdui = 6161 } @{ '6161' = 0 } $fxSel
$got = Get-Calls
Test-Result 'ID-2 google documentsui in front' ($r.rc -eq '0' -and $got.Count -eq 4 -and $got[0] -eq (Get-Pidof $pg[0] $dui) -and $got[1] -eq (Get-Pidof $pg[0] $gdui) -and $got[2] -eq (Get-Adj $pg[0] '6161') -and (Get-LogText).Contains(' front=' + $gdui + ' ')) ('-> ' + $r.rc + ' calls=' + ($got -join ' | '))
# ID-3: only longer sibling ids (select_all, select_x): no-match, state lock and log lock.
$r = Invoke-Pick $pg[0] @('--id', $ok) $frontDui $adjDui $fxSib
Test-Result 'ID-3 longer sibling ids only' ($r.rc -eq '3' -and $r.out -eq 'no-match' -and (Test-Locked) -and (Get-LogText).Contains('PICK-LOCK pick id=')) ('-> ' + $r.rc + ' ' + $r.out)
# ID-3b: a single select_all sibling and no confirm node must not be located as the confirm button.
$r = Invoke-Pick $pg[0] @('--id', $ok) $frontDui $adjDui $fxSib1
Test-Result 'ID-3b single select_all sibling' ($r.rc -eq '3' -and $r.out -eq 'no-match' -and (Test-Locked)) ('-> ' + $r.rc + ' ' + $r.out)
# ID-4: a requested id that is a prefix of the node id matches nothing.
$r = Invoke-Pick $pg[0] @('--id', ($pre + 'action_menu_sel')) $frontDui $adjDui $fxSel
Test-Result 'ID-4 requested id shorter than the node id' ($r.rc -eq '3' -and $r.out -eq 'no-match' -and (Test-Locked)) ('-> ' + $r.rc + ' ' + $r.out)
# ID-5: the exact node next to longer siblings is the one hit.
$r = Invoke-Pick $pg[0] @('--id', $ok) $frontDui $adjDui $fxSibPlus
Test-Result 'ID-5 exact node plus siblings' ($r.rc -eq '0' -and $r.out -eq ('match bounds=' + $expectBounds)) ('-> ' + $r.rc + ' ' + $r.out)
# ID-6: two exact nodes are no unique match.
$r = Invoke-Pick $pg[0] @('--id', $ok) $frontDui $adjDui $fxTwo
Test-Result 'ID-6 two exact nodes' ($r.rc -eq '3' -and $r.out -eq 'no-match' -and (Test-Locked)) ('-> ' + $r.rc + ' ' + $r.out)
# ID-7: an --id no-match locks --name, through the state and, with the state lock removed, through the log line alone.
$null = Invoke-Pick $pg[0] @('--id', $ok) $frontDui $adjDui $fxSib
$r = Invoke-Pick $pg[0] @('--name', 'c850-card.png') $frontDui $adjDui $fxSel '0' -Keep
Test-Result 'ID-7 --id no-match locks --name (state)' ($r.rc -eq '98' -and (Get-Calls).Count -eq 0) ('-> ' + $r.rc + ' calls=' + (Get-Calls).Count)
$sObj = Get-State
$sObj.pickLocked = $false
$sObj | ConvertTo-Json -Depth 8 | Set-Content $st
$r = Invoke-Pick $pg[0] @('--name', 'c850-card.png') $frontDui $adjDui $fxSel '0' -Keep
Test-Result 'ID-7 --id no-match locks --name (log only)' ($r.rc -eq '98' -and (Get-Calls).Count -eq 0) ('-> ' + $r.rc + ' calls=' + (Get-Calls).Count)
# ID-8: a --name no-match locks --id.
$null = Invoke-Pick $pg[0] @('--name', 'nothing-here') $frontDui $adjDui $fxSel
$r = Invoke-Pick $pg[0] @('--id', $ok) $frontDui $adjDui $fxSel '0' -Keep
Test-Result 'ID-8 --name no-match locks --id' ($r.rc -eq '98' -and (Get-Calls).Count -eq 0) ('-> ' + $r.rc + ' calls=' + (Get-Calls).Count)
# ID-9: no system file picker in front gives 93 with no dump, no lock, one pick error and no front= line.
$noFront = @(
    @{ n = 'a own package at 0, pickers in the background'; args = @('--id', $ok, '--own-package', $pkg); pids = @{ $pkg = 4242; $dui = 5151; $gdui = 6161 }; adj = @{ '4242' = 0; '5151' = 100; '6161' = 100 } },
    @{ n = 'b no picker running'; args = @('--id', $ok); pids = @{}; adj = @{} },
    @{ n = 'c other apps at 0'; args = @('--id', $ok); pids = @{ 'com.sec.android.app.myfiles' = 7171; 'com.android.chrome' = 8181 }; adj = @{ '7171' = 0; '8181' = 0 } },
    @{ n = 'd pickers at adj 200'; args = @('--id', $ok); pids = @{ $dui = 5151; $gdui = 6161 }; adj = @{ '5151' = 200; '6161' = 200 } }
)
foreach ($c in $noFront) {
    $r = Invoke-Pick $pg[1] $c.args $c.pids $c.adj $fxSel
    $joined = (Get-Calls) -join ' '
    Test-Result ('ID-9' + $c.n) ($r.rc -eq '93' -and -not $joined.Contains('uiautomator') -and -not (Test-Locked) -and (Get-PickErrors) -eq 1 -and -not (Get-LogText).Contains(' front=')) ('-> ' + $r.rc + ' errors=' + (Get-PickErrors) + ' calls=' + $joined)
}
# ID-10: two front refusals reach the two-error cap of both forms.
$null = Invoke-Pick $pg[0] @('--id', $ok) @{} @{} $fxSel
$null = Invoke-Pick $pg[0] @('--id', $ok) @{} @{} $fxSel '0' -Keep
$r = Invoke-Pick $pg[0] @('--id', $ok) $frontDui $adjDui $fxSel '0' -Keep
Test-Result 'ID-10 cap after two 93s (--id)' ($r.rc -eq '98' -and (Get-Calls).Count -eq 0) ('-> ' + $r.rc + ' calls=' + (Get-Calls).Count)
$null = Invoke-Pick $pg[0] @('--id', $ok) @{} @{} $fxSel
$null = Invoke-Pick $pg[0] @('--id', $ok) @{} @{} $fxSel '0' -Keep
$r = Invoke-Pick $pg[0] @('--name', 'c850-card.png') $frontDui $adjDui $fxSel '0' -Keep
Test-Result 'ID-10x cap after two 93s (--name)' ($r.rc -eq '98' -and (Get-Calls).Count -eq 0) ('-> ' + $r.rc + ' calls=' + (Get-Calls).Count)
# ID-11: the emulator is not a playground serial.
$r = Invoke-Pick 'emulator-5580' @('--id', $ok) $frontDui $adjDui $fxSel
Test-Result 'ID-11 emulator-5580' ($r.rc -eq '97' -and (Get-Calls).Count -eq 0) ('-> ' + $r.rc + ' calls=' + (Get-Calls).Count)
# ID-12: restricted and near-miss serials are refused before any parsing.
foreach ($s in @('R58M12345AB', '2ac80128013f7ecf', '29F3CDE9193F7ECE')) {
    $r = Invoke-Pick $s @('--id', $ok) $frontDui $adjDui $fxSel
    Test-Result ('ID-12 ' + $s) ($r.rc -eq '95' -and (Get-Calls).Count -eq 0) ('-> ' + $r.rc + ' calls=' + (Get-Calls).Count)
}
# ID-13: a dump failure and zero-area bounds are errors, not no-matches.
$r = Invoke-Pick $pg[0] @('--id', $ok) $frontDui $adjDui $fxSel '1'
Test-Result 'ID-13 dump failure' ($r.rc -eq '4' -and (Get-PickErrors) -eq 1 -and -not (Test-Locked)) ('-> ' + $r.rc)
$r = Invoke-Pick $pg[0] @('--id', $ok) $frontDui $adjDui $fxZero
Test-Result 'ID-13 zero-area bounds' ($r.rc -eq '4' -and (Get-PickErrors) -eq 1 -and -not (Test-Locked)) ('-> ' + $r.rc)

# ID-R: every malformed id or argument exits 2 with no adb call and no state change; the dump holds every other-package node.
$longName = 'a' + ('b' * 80)
$bad = [ordered]@{
    'other package google'     = @('--id', 'com.google.android.documentsui:id/action_menu_select')
    'other package android'    = @('--id', 'android:id/button2')
    'other package app'        = @('--id', 'io.github.yor42.risutanium:id/action_menu_select')
    'other package suffix'     = @('--id', 'com.android.documentsuix:id/action_menu_select')
    'other package prefix'     = @('--id', 'xcom.android.documentsui:id/action_menu_select')
    'other package dots'       = @('--id', 'com1android1documentsui:id/action_menu_select')
    'other resource type'      = @('--id', 'com.android.documentsui:string/action_menu_select')
    'dotdot leading'           = @('--id', ($pre + '../action_menu_select'))
    'dotdot trailing'          = @('--id', ($ok + '/..'))
    'wildcard star'            = @('--id', ($pre + '*'))
    'wildcard prefix star'     = @('--id', ($pre + 'action_menu_*'))
    'wildcard question'        = @('--id', ($pre + 'action_menu_selec?'))
    'wildcard dot star'        = @('--id', ($pre + '.*'))
    'wildcard class star'      = @('--id', ($pre + 'action_menu_[a-z]*'))
    'non-ascii hangul'         = @('--id', ($pre + $sun))
    'non-ascii cyrillic'       = @('--id', ([string][char]0x0441 + 'om.android.documentsui:id/action_menu_select'))
    'non-ascii fullwidth'      = @('--id', ($pre + [string][char]0xFF41 + 'ction_menu_select'))
    'empty id'                 = @('--id', '')
    'empty name'               = @('--id', $pre)
    'missing value'            = @('--id')
    'value is an option'       = @('--id', '--state', $st)
    'extra token'              = @('--id', $ok, 'extra')
    'adb section'              = @('--id', $ok, '--', 'shell', 'ls', '/sdcard')
    'both forms'               = @('--id', $ok, '--name', 'c850-card.png')
    'duplicate id'             = @('--id', $ok, '--id', $ok)
    'unknown option'           = @('--id', $ok, '--x', '1')
    'case package'             = @('--id', 'COM.ANDROID.DOCUMENTSUI:id/action_menu_select')
    'case id word'             = @('--id', 'com.android.documentsui:ID/action_menu_select')
    'case name upper'          = @('--id', ($pre + 'ACTION_MENU_SELECT'))
    'case name capital'        = @('--id', ($pre + 'Action_menu_select'))
    'injection double quote'   = @('--id', ($ok + '"'))
    'injection single quote'   = @('--id', ($ok + "'"))
    'injection semicolon'      = @('--id', ($ok + ';ls'))
    'injection embedded blank' = @('--id', ($pre + 'action_menu select'))
    'injection leading blank'  = @('--id', (' ' + $ok))
    'injection trailing LF'    = @('--id', ($ok + "`n"))
    'length 81'                = @('--id', ($pre + $longName))
}
foreach ($k in $bad.Keys) { Test-Refused2 ('ID-R ' + $k) $bad[$k] }
# The longest accepted name (80 chars) still reaches the device.
$r = Invoke-Pick $pg[1] @('--id', ($pre + $longName.Substring(0, 80))) $frontDui $adjDui $fxOther
Test-Result 'ID-R length 80 accepted' ($r.rc -eq '3' -and (Get-Calls).Count -eq 3) ('-> ' + $r.rc + ' calls=' + (Get-Calls).Count)

# ---- pick --name stays as it was ----
# CG-N1: one adb call only, no front check.
$r = Invoke-Pick $pg[0] @('--name', 'c850-card.png') @{} @{} $fxSel
$got = Get-Calls
Test-Result 'CG-N1 --name match, one call, no front check' ($r.rc -eq '0' -and $r.out -eq 'match bounds=[200,400][1200,480]' -and $got.Count -eq 1) ('-> ' + $r.rc + ' ' + $r.out + ' calls=' + $got.Count)
# CG-N4: the --name device script is today's literal template (the dump name aside); the --id script uses the same template.
$scriptTail = ' 2>/dev/null | head -n 2 | grep -o ''bounds="[^"]*"''; fi; rm -f <D>; [ -e <D> ] && echo ADBG-RM-FAILED; echo ADBG-DUMP=$d'
$bounds = 'bounds="\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]"'
$dumpHead = 'uiautomator dump <D> >/dev/null 2>&1; d=$?; if [ $d -eq 0 ]; then grep -o '''
$wantName = $dumpHead + 'text="c850-card\.png"[^>]*' + $bounds + ''' <D>' + $scriptTail
$wantId = $dumpHead + ' resource-id="com\.android\.documentsui:id/action_menu_select"[^>]*' + $bounds + ''' <D>' + $scriptTail
$gotName = ((Get-Calls)[0] | ConvertFrom-Json)[3] -replace '/sdcard/adbg-pick-\d+-\d+\.xml', '<D>'
Test-Result 'CG-N4 --name device script' ($gotName -ceq $wantName) ('-> ' + $gotName)
$null = Invoke-Pick $pg[0] @('--id', $ok) $frontDui $adjDui $fxSel
$gotId = ((Get-Calls)[2] | ConvertFrom-Json)[3] -replace '/sdcard/adbg-pick-\d+-\d+\.xml', '<D>'
Test-Result 'ID-script --id device script' ($gotId -ceq $wantId) ('-> ' + $gotId)
# CG-N2: a non-ASCII name is refused before any call.
$r = Invoke-Pick $pg[0] @('--name', $sun) $frontDui $adjDui $fxSel
Test-Result 'CG-N2 --name non-ASCII' ($r.rc -eq '2' -and (Get-Calls).Count -eq 0) ('-> ' + $r.rc)
# CG-N3: a --name no-match locks the next --name.
$r = Invoke-Pick $pg[0] @('--name', 'nothing-here') $frontDui $adjDui $fxSel
$r2 = Invoke-Pick $pg[0] @('--name', 'c850-card.png') $frontDui $adjDui $fxSel '0' -Keep
Test-Result 'CG-N3 --name no-match then locked' ($r.rc -eq '3' -and $r2.rc -eq '98' -and (Get-Calls).Count -eq 0) ('-> ' + $r.rc + ' then ' + $r2.rc)

# ---- RM: the README claim about rm ----
function Invoke-Adb([string]$ser, [string[]]$adbArgs) {
    Reset-Run
    & node $GuardPath --serial $ser --log $log -- @adbArgs 2>$null | Out-Null
    [string]$LASTEXITCODE
}
$rmRefused = @('rm /sdcard/Download/a.txt', 'rm -r /sdcard/Download/a.txt', 'rm -rf /sdcard/Download/a.txt', 'rm -f /sdcard/Download/a.txt /sdcard/Download/b.txt', 'rm -f /sdcard/Download/*', 'rm -f /sdcard/a.txt', 'rm -f /sdcard/Download/sub/a.txt', 'rm -f /sdcard/Download/.x')
$rmAllowed = @('rm -f /sdcard/Download/a.txt', 'rm -f /data/local/tmp/a.txt')
# The Note 9 profile (r3) lifted the rm shape rule on the playground serials (full shell, FC-1): every rm form passes there. The refusals
# are pinned on emulator-5580, which keeps the r11 allowlist.
foreach ($c in $rmRefused) {
    $rc = Invoke-Adb 'emulator-5580' @('shell', $c)
    Test-Result ('RM emulator-5580 refuses ' + $c) ($rc -eq '97' -and (Get-Calls).Count -eq 0) ('-> ' + $rc)
}
foreach ($s in @('emulator-5580', $pg[1])) {
    foreach ($c in $rmAllowed) {
        $rc = Invoke-Adb $s @('shell', $c)
        Test-Result ('RM ' + $s + ' allows ' + $c) ($rc -eq '0' -and (Get-Calls).Count -eq 1) ('-> ' + $rc)
    }
}
foreach ($c in $rmRefused) {
    $rc = Invoke-Adb $pg[1] @('shell', $c)
    Test-Result ('RM ' + $pg[1] + ' passes ' + $c + ' on the Note 9 profile') ($rc -eq '0' -and (Get-Calls).Count -eq 1) ('-> ' + $rc)
}
foreach ($c in @($rmRefused + $rmAllowed)) {
    $rc = Invoke-Adb 'R58M12345AB' @('shell', $c)
    Test-Result ('RM restricted refuses ' + $c) ($rc -eq '95' -and (Get-Calls).Count -eq 0) ('-> ' + $rc)
}
# The r14 export path as separate arguments: playground only; a plain name in that split form is refused.
$rc = Invoke-Adb $pg[1] @('shell', 'rm', '-f', '/sdcard/Download/local-abc.bin')
Test-Result 'RM playground r14 split form' ($rc -eq '0' -and (Get-Calls).Count -eq 1) ('-> ' + $rc)
$rc = Invoke-Adb 'emulator-5580' @('shell', 'rm', '-f', '/sdcard/Download/local-abc.bin')
Test-Result 'RM emulator r14 split form refused' ($rc -eq '97' -and (Get-Calls).Count -eq 0) ('-> ' + $rc)
$rc = Invoke-Adb 'emulator-5580' @('shell', 'rm', '-f', '/sdcard/Download/a.txt')
Test-Result 'RM emulator split form of a plain name refused' ($rc -eq '97' -and (Get-Calls).Count -eq 0) ('-> ' + $rc)
$rc = Invoke-Adb $pg[1] @('shell', 'rm', '-f', '/sdcard/Download/a.txt')
Test-Result 'RM playground split form of a plain name passes on the Note 9 profile' ($rc -eq '0' -and (Get-Calls).Count -eq 1) ('-> ' + $rc)

foreach ($v in @('ADBG_FAKE_ADB_SCRIPT', 'FAKE_CALLS', 'FAKE_PIDS', 'FAKE_ADJ', 'FAKE_DUMP', 'FAKE_DUMP_EXIT')) { Remove-Item Env:$v -ErrorAction SilentlyContinue }
Remove-Item -LiteralPath $testDir -Recurse -Force -ErrorAction SilentlyContinue
'failures=' + $script:failures
exit $script:failures
