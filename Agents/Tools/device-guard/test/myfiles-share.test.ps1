# Fake-adb cases for adbg r17 (CHORE-128 S13): Samsung My Files on phone 1 only, for sharing synthetic Download/c128-* files into the app.
# Covers the pinned am start, pick/tap/hold --myfiles, the c128-*/navigation/share text allowlist, the destructive menu texts, and the
# same calls on every other serial (all refused). No real device is touched: every adb call goes to the fake.
# Usage: pwsh -File myfiles-share.test.ps1 -GuardPath <adbg.mjs>
param([Parameter(Mandatory = $true)][string]$GuardPath)
$PSNativeCommandArgumentPassing = 'Standard'
$testDir = Join-Path ([IO.Path]::GetTempPath()) ('adbg-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testDir | Out-Null
$fake = Join-Path $testDir 'fake.mjs'
$calls = Join-Path $testDir 'calls.txt'
# The fake adb records every call as one JSON array. FAKE_PIDS maps a package to its pid (a missing package makes pidof exit 1), FAKE_ADJ maps a
# pid to its oom_score_adj (a missing pid reads 900). For the pick device command it runs the guard's own grep pattern as a JS RegExp over the
# fixture named by FAKE_DUMP, keeps the first two hits (head -n 2) and prints only their bounds, then ADBG-DUMP=0.
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
  const pat = a[3].match(/grep -o '([^']*)'/)[1]
  const xml = readFileSync(process.env.FAKE_DUMP, "utf8")
  let out = ""
  for (const h of (xml.match(new RegExp(pat, "g")) ?? []).slice(0, 2)) out += h.match(/bounds="[^"]*"/)[0] + "\n"
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
$phone1 = '29f3cde9193f7ece'
$phone2 = '2ac80128013f7ece'
$emu = 'emulator-5580'
$tabS9 = 'R54WA00L3WH'
$mf = 'com.sec.android.app.myfiles'
$pkg = 'io.github.yor42.risutanium'
$startString = 'am start -n ' + $mf + '/.external.ui.MainActivity'
function ConvertFrom-Codes([int[]]$codes) { -join ($codes | ForEach-Object { [string][char]$_ }) }
$koDownload = ConvertFrom-Codes 0xB2E4, 0xC6B4, 0xB85C, 0xB4DC
$koInternal = ConvertFrom-Codes 0xB0B4, 0xC7A5, 0x20, 0xBA54, 0xBAA8, 0xB9AC
$koShare = ConvertFrom-Codes 0xACF5, 0xC720
$koRename = ConvertFrom-Codes 0xC774, 0xB984, 0x20, 0xBCC0, 0xACBD
$koDelete = ConvertFrom-Codes 0xC0AD, 0xC81C
$koMove = ConvertFrom-Codes 0xC774, 0xB3D9
$koCopy = ConvertFrom-Codes 0xBCF5, 0xC0AC
$koCompress = ConvertFrom-Codes 0xC555, 0xCD95
$koDetails = ConvertFrom-Codes 0xC0C1, 0xC138, 0x20, 0xC815, 0xBCF4
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
function Reset-Run { Reset-Calls; Remove-Item $log -ErrorAction SilentlyContinue; Remove-Item $st -ErrorAction SilentlyContinue }

# ---- fixture, shaped like the uiautomator dump of My Files: one line, no BOM, the dumper's attribute order ----
function New-Leaf([string]$text, [string]$bounds) {
    '<node index="0" text="' + $text + '" resource-id="" class="android.widget.TextView" package="' + $mf + '" content-desc="" checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="true" password="false" selected="false" bounds="' + $bounds + '" />'
}
$names = @('c128-card.png', 'c128-delete.png', 'Download', $koDownload, 'Internal storage', $koInternal, 'Share', $koShare, 'RisuTanium', 'DCIM', 'c127-card.png',
    'Rename', 'Delete', 'Move', 'Copy', 'Compress', 'Details', 'Move to Trash', $koRename, $koDelete, $koMove, $koCopy, $koCompress, $koDetails)
$leaves = @()
$row = 0
foreach ($n in $names) { $leaves += New-Leaf $n ('[200,' + (100 + 100 * $row) + '][1200,' + (180 + 100 * $row) + ']'); $row++ }
$xml = "<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation=""0""><node index=""0"" text="""" resource-id="""" class=""android.widget.FrameLayout"" package=""" + $mf + """ bounds=""[0,0][1440,2960]"">" + ($leaves -join '') + '</node></hierarchy>'
$fx = Join-Path $testDir 'myfiles.xml'
[IO.File]::WriteAllText($fx, $xml, (New-Object System.Text.UTF8Encoding($false)))
# The c128-card.png row is the first: [200,100][1200,180], centre 700,140.
$cardBounds = '[200,100][1200,180]'

$frontMf = @{ $mf = 7171 }
$adjFront = @{ '7171' = 0 }
$adjBehind = @{ '7171' = 100 }
$adjCached = @{ '7171' = 900 }
$frontOwn = @{ $pkg = 4242; $mf = 7171 }
$adjOwn = @{ '4242' = 0; '7171' = 900 }
function Invoke-Node([string[]]$nodeArgs, [hashtable]$pids, [hashtable]$adjs, [switch]$Keep) {
    if (-not $Keep) { Reset-Run } else { Reset-Calls }
    $env:FAKE_PIDS = ConvertTo-Json1 $pids
    $env:FAKE_ADJ = ConvertTo-Json1 $adjs
    $env:FAKE_DUMP = $fx
    $out = (& node $GuardPath @nodeArgs 2>$null) -join "`n"
    [pscustomobject]@{ rc = [string]$LASTEXITCODE; out = $out }
}
function Get-PickArgs([string]$ser, [string]$text) { @('pick', '--serial', $ser, '--log', $log, '--state', $st, '--myfiles', '--name', $text) }
function Get-TapArgs([string]$ser) { @('tap', '--serial', $ser, '--log', $log, '--state', $st, '--myfiles', '--max-age', '10') }
function Get-HoldArgs([string]$ser) { @('hold', '--serial', $ser, '--log', $log, '--state', $st, '--myfiles', '--duration-ms', '800', '--max-age', '10') }
function Get-Pidof([string]$ser, [string]$p) { '["-s","' + $ser + '","shell","pidof ' + $p + '"]' }
# A refused pick sends no adb call and changes no state: no lock, no error count.
function Test-PickRefused([string]$label, [string]$ser, [string]$text, [string]$wantRc) {
    $r = Invoke-Node (Get-PickArgs $ser $text) $frontMf $adjFront
    $s = Get-State
    $quiet = (-not $s) -or (-not $s.pickLocked -and [int]$s.pickErrors -eq 0)
    Test-Result $label ($r.rc -eq $wantRc -and (Get-Calls).Count -eq 0 -and $quiet) ('-> ' + $r.rc + ' (want ' + $wantRc + ') calls=' + (Get-Calls).Count)
}
function Test-AdbRefused([string]$label, [string]$ser, [string[]]$adbArgs, [string]$wantRc, [string[]]$extra = @()) {
    $r = Invoke-Node (@('--serial', $ser, '--log', $log) + $extra + @('--') + $adbArgs) @{} @{}
    Test-Result $label ($r.rc -eq $wantRc -and (Get-Calls).Count -eq 0) ('-> ' + $r.rc + ' (want ' + $wantRc + ') calls=' + (Get-Calls).Count)
}

# MF-1: the pinned My Files start passes on phone 1 only, as one exact command string.
$r = Invoke-Node @('--serial', $phone1, '--log', $log, '--', 'shell', $startString) @{} @{}
$got = Get-Calls
Test-Result 'MF-1 am start My Files on phone 1' ($r.rc -eq '0' -and $got.Count -eq 1 -and $got[0] -eq ('["-s","' + $phone1 + '","shell","' + $startString + '"]') -and (Get-LogText).Contains('PLAYGROUND serial=' + $phone1 + ' allow=extended')) ('-> ' + $r.rc + ' calls=' + ($got -join ' | '))
$r = Invoke-Node @('--serial', $phone1, '--log', $log, '--own-package', $pkg, '--', 'shell', ('  ' + $startString.Replace(' -n ', '  -n '))) @{} @{}
Test-Result 'MF-1 am start with extra blanks still the same command' ($r.rc -eq '0' -and (Get-Calls).Count -eq 1) ('-> ' + $r.rc)

# MF-2: the same launch on every other serial is refused, also when --own-package names My Files.
Test-AdbRefused 'MF-2 phone 2 am start' $phone2 @('shell', $startString) '97'
Test-AdbRefused 'MF-2 phone 2 am start with own-package My Files' $phone2 @('shell', $startString) '97' @('--own-package', $mf)
Test-AdbRefused 'MF-2 emulator am start' $emu @('shell', $startString) '97'
Test-AdbRefused 'MF-2 emulator am start with own-package My Files' $emu @('shell', $startString) '97' @('--own-package', $mf)
foreach ($s in @($tabS9, 'R58M12345AB', '2ac80128013f7ecf', '29F3CDE9193F7ECE', ($phone1 + '1'))) {
    Test-AdbRefused ('MF-2 ' + $s + ' am start') $s @('shell', $startString) '95'
    Test-AdbRefused ('MF-2 ' + $s + ' am start with own-package My Files') $s @('shell', $startString) '95' @('--own-package', $mf)
}
# Any other `am` naming My Files, a wrong component or a split form stays refused on phone 1.
$badStarts = @(
    ($startString + ' --es k v'), ($startString.Replace('.external.ui.MainActivity', '.presentation.main.MainActivity')), ($startString.Replace('.external.ui.MainActivity', '.Other')),
    ('am start -a android.intent.action.VIEW -n ' + $mf + '/.external.ui.MainActivity'), ('am start -W -n ' + $mf + '/.external.ui.MainActivity'),
    ('am start -d content://media/external/file/1 -n ' + $mf + '/.external.ui.MainActivity'), ('am start -n ' + $mf + '.evil/.external.ui.MainActivity'),
    ('am start -n com.evil/' + $mf + '.external.ui.MainActivity'), ('am force-stop ' + $mf), ('am kill ' + $mf), ('am start-activity -n ' + $mf + '/.external.ui.MainActivity'),
    ('am start -n ' + $mf + '/.external.ui.MainActivity; reboot'), ('am start -n ' + $mf.ToUpper() + '/.external.ui.MainActivity'))
foreach ($c in $badStarts) { Test-AdbRefused ('MF-2 phone 1 refuses ' + $c) $phone1 @('shell', $c) '97' }
Test-AdbRefused 'MF-2 phone 1 refuses the start split into arguments' $phone1 (@('shell') + $startString.Split(' ')) '97'
Test-AdbRefused 'MF-2 phone 1 refuses the start with own-package My Files and a flag' $phone1 @('shell', ($startString + ' --es k v')) '97' @('--own-package', $mf)
# monkey, pm list and content queries stay refused on both phones, also when they name My Files.
foreach ($s in @($phone1, $phone2)) {
    foreach ($c in @(('monkey -p ' + $mf + ' -c android.intent.category.LAUNCHER 1'), 'monkey 100', 'pm list packages', ('pm list packages ' + $mf), 'content query --uri content://media/external/file', 'content query --uri content://sms/inbox')) {
        Test-AdbRefused ('MF-2 ' + $s + ' refuses ' + $c) $s @('shell', $c) '97'
    }
}

# MF-3: pick --myfiles on phone 1 with My Files in front: the allowed texts reach the dump and give one locate.
$allowedTexts = @('c128-card.png', 'c128-delete.png', 'Download', $koDownload, 'Internal storage', $koInternal, 'Share', $koShare)
foreach ($t in $allowedTexts) {
    $r = Invoke-Node (Get-PickArgs $phone1 $t) $frontMf $adjFront
    $got = Get-Calls
    $loc = (Get-State).locates[0]
    $okMatch = $r.rc -eq '0' -and $r.out.StartsWith('match bounds=[200,') -and $got.Count -eq 3 -and $got[0] -eq (Get-Pidof $phone1 $mf) -and $got[2].Contains('uiautomator dump')
    Test-Result ('MF-3 pick --myfiles ' + $t) ($okMatch -and $loc.label -eq ('pick-myfiles:' + $t) -and $loc.myFiles -eq $true -and (Get-LogText).Contains('PLAYGROUND serial=' + $phone1 + ' front=' + $mf + ' (Samsung My Files, pick --myfiles, r17)')) ('-> ' + $r.rc + ' ' + $r.out + ' calls=' + $got.Count)
}
# The share-sheet target needs My Files at least visible behind the sheet (adj 0 or 100), not cached.
foreach ($a in @($adjFront, $adjBehind)) {
    $r = Invoke-Node (Get-PickArgs $phone1 'RisuTanium') $frontMf $a
    Test-Result ('MF-3 pick --myfiles RisuTanium with My Files adj ' + $a['7171']) ($r.rc -eq '0' -and $r.out.StartsWith('match bounds=[200,')) ('-> ' + $r.rc + ' ' + $r.out)
}
$r = Invoke-Node (Get-PickArgs $phone1 'RisuTanium') $frontMf $adjCached
Test-Result 'MF-3 pick --myfiles RisuTanium with My Files cached' ($r.rc -eq '93' -and -not ((Get-Calls) -join ' ').Contains('uiautomator') -and -not (Test-Locked)) ('-> ' + $r.rc)
# A file row is not located while My Files is merely visible behind something else.
$r = Invoke-Node (Get-PickArgs $phone1 'c128-card.png') $frontMf $adjBehind
Test-Result 'MF-3 pick --myfiles file name needs My Files in front (adj 100)' ($r.rc -eq '93' -and -not ((Get-Calls) -join ' ').Contains('uiautomator')) ('-> ' + $r.rc)

# MF-4: texts outside the allowlist, a non-c128 file name and the destructive menu texts refuse with no adb call.
$notAllowed = @('DCIM', 'c127-card.png', 'c128card', 'x-c128-card.png', 'C128-card.png', 'c128-', 'c128-a/b', 'c128-a b', 'c128-..', 'Android', 'Documents', 'Pictures', 'Select all', 'download', 'Internal Storage', 'My Files', 'RisuTanium2', 'risutanium', ('c128-' + ('a' * 73)))
foreach ($t in $notAllowed) { Test-PickRefused ('MF-4 pick --myfiles refuses ' + $t) $phone1 $t '97' }
$destructive = @('Rename', 'Delete', 'Move', 'Copy', 'Compress', 'Details', 'Move to Trash', 'Extract', 'Create folder', 'Empty', 'delete', 'DELETE', $koRename, $koDelete, $koMove, $koCopy, $koCompress, $koDetails)
foreach ($t in $destructive) {
    Test-PickRefused ('MF-4 pick --myfiles refuses menu text ' + $t) $phone1 $t '97'
    Test-Result ('MF-4 refusal names the destructive menu ' + $t) ((Get-LogText).Contains('destructive My Files menu text')) ''
}

# MF-5: pick --myfiles on every other serial is refused before any adb call.
Test-PickRefused 'MF-5 pick --myfiles on phone 2' $phone2 'c128-card.png' '97'
Test-PickRefused 'MF-5 pick --myfiles on emulator' $emu 'c128-card.png' '97'
foreach ($s in @($tabS9, 'R58M12345AB', '2ac80128013f7ecf', '29F3CDE9193F7ECE')) { Test-PickRefused ('MF-5 pick --myfiles on ' + $s) $s 'c128-card.png' '95' }
foreach ($s in @($phone2, $emu)) {
    Test-PickRefused ('MF-5 pick --myfiles Download on ' + $s) $s 'Download' '97'
    Test-PickRefused ('MF-5 pick --myfiles RisuTanium on ' + $s) $s 'RisuTanium' '97'
}

# MF-6: My Files not in front gives 93 with no dump, no lock and one pick error.
$noFront = @(
    @{ n = 'a own package at 0, My Files in the background'; pids = $frontOwn; adj = $adjOwn },
    @{ n = 'b My Files not running'; pids = @{}; adj = @{} },
    @{ n = 'c My Files cached'; pids = $frontMf; adj = $adjCached }
)
foreach ($c in $noFront) {
    $r = Invoke-Node (Get-PickArgs $phone1 'c128-card.png') $c.pids $c.adj
    $joined = (Get-Calls) -join ' '
    Test-Result ('MF-6' + $c.n) ($r.rc -eq '93' -and -not $joined.Contains('uiautomator') -and -not (Test-Locked) -and (Get-PickErrors) -eq 1) ('-> ' + $r.rc + ' errors=' + (Get-PickErrors))
}

# MF-7: tap --myfiles consumes a --myfiles locate, repeats the foreground check, and a locate of the other mode cannot cross over.
$null = Invoke-Node (Get-PickArgs $phone1 'c128-card.png') $frontMf $adjFront
$r = Invoke-Node (Get-TapArgs $phone1) $frontMf $adjFront -Keep
$got = Get-Calls
Test-Result 'MF-7 tap --myfiles taps the centre and consumes the locate' ($r.rc -eq '0' -and $got.Count -eq 3 -and $got[2] -eq ('["-s","' + $phone1 + '","shell","input","tap","700","140"]') -and (Get-State).locates[0].used -and (Get-LogText).Contains('Samsung My Files, tap --myfiles, r17')) ('-> ' + $r.rc + ' calls=' + ($got -join ' | '))
$null = Invoke-Node (Get-PickArgs $phone1 'c128-card.png') $frontMf $adjFront
$r = Invoke-Node (Get-TapArgs $phone1) $frontOwn $adjOwn -Keep
$joined = (Get-Calls) -join ' '
Test-Result 'MF-7 tap --myfiles refuses when My Files left the front, locate stays unused' ($r.rc -eq '93' -and -not $joined.Contains('"input"') -and -not (Get-State).locates[0].used) ('-> ' + $r.rc)
$null = Invoke-Node (Get-PickArgs $phone1 'RisuTanium') $frontMf $adjFront
$r = Invoke-Node (Get-TapArgs $phone1) $frontMf $adjBehind -Keep
Test-Result 'MF-7 tap --myfiles on the share target with My Files behind the sheet' ($r.rc -eq '0' -and ((Get-Calls) -join ' ').Contains('"input","tap"')) ('-> ' + $r.rc)
$null = Invoke-Node (Get-PickArgs $phone1 'c128-card.png') $frontMf $adjFront
$r = Invoke-Node @('tap', '--serial', $phone1, '--log', $log, '--state', $st, '--max-age', '10') $frontMf $adjFront -Keep
Test-Result 'MF-7 a --myfiles locate cannot be used by a plain tap' ($r.rc -eq '99' -and -not ((Get-Calls) -join ' ').Contains('"input"')) ('-> ' + $r.rc)
$null = Invoke-Node @('pick', '--serial', $phone1, '--log', $log, '--state', $st, '--name', 'c128-card.png') $frontMf $adjFront
$r = Invoke-Node (Get-TapArgs $phone1) $frontMf $adjFront -Keep
Test-Result 'MF-7 a plain pick locate cannot be used by tap --myfiles' ($r.rc -eq '99' -and -not ((Get-Calls) -join ' ').Contains('"input"')) ('-> ' + $r.rc)
$r = Invoke-Node (Get-TapArgs $phone1) $frontMf $adjFront
Test-Result 'MF-7 tap --myfiles without a locate' ($r.rc -eq '99' -and (Get-Calls).Count -eq 0) ('-> ' + $r.rc)
foreach ($s in @($phone2, $emu)) {
    $r = Invoke-Node (Get-TapArgs $s) $frontMf $adjFront
    Test-Result ('MF-7 tap --myfiles on ' + $s) ($r.rc -eq '97' -and (Get-Calls).Count -eq 0) ('-> ' + $r.rc)
    $r = Invoke-Node (Get-HoldArgs $s) $frontMf $adjFront
    Test-Result ('MF-7 hold --myfiles on ' + $s) ($r.rc -eq '97' -and (Get-Calls).Count -eq 0) ('-> ' + $r.rc)
}
foreach ($s in @($tabS9, 'R58M12345AB')) {
    $r = Invoke-Node (Get-TapArgs $s) $frontMf $adjFront
    Test-Result ('MF-7 tap --myfiles on ' + $s) ($r.rc -eq '95' -and (Get-Calls).Count -eq 0) ('-> ' + $r.rc)
    $r = Invoke-Node (Get-HoldArgs $s) $frontMf $adjFront
    Test-Result ('MF-7 hold --myfiles on ' + $s) ($r.rc -eq '95' -and (Get-Calls).Count -eq 0) ('-> ' + $r.rc)
}

# MF-8: hold --myfiles needs no --own-package, sends the zero-distance swipe after the check, and refuses a foreground miss.
$null = Invoke-Node (Get-PickArgs $phone1 'c128-card.png') $frontMf $adjFront
$r = Invoke-Node (Get-HoldArgs $phone1) $frontMf $adjFront -Keep
$got = Get-Calls
Test-Result 'MF-8 hold --myfiles presses the centre' ($r.rc -eq '0' -and $got.Count -eq 3 -and $got[2] -eq ('["-s","' + $phone1 + '","shell","input","swipe","700","140","700","140","800"]') -and (Get-State).locates[0].used) ('-> ' + $r.rc + ' calls=' + ($got -join ' | '))
$null = Invoke-Node (Get-PickArgs $phone1 'c128-card.png') $frontMf $adjFront
$r = Invoke-Node (Get-HoldArgs $phone1) $frontOwn $adjOwn -Keep
Test-Result 'MF-8 hold --myfiles refuses when My Files is not in front' ($r.rc -eq '93' -and -not ((Get-Calls) -join ' ').Contains('"input"') -and -not (Get-State).locates[0].used) ('-> ' + $r.rc)
# swipe, tap-home, adb and the other verbs do not take --myfiles; malformed pick --myfiles forms exit 2.
$null = Invoke-Node (Get-PickArgs $phone1 'c128-card.png') $frontMf $adjFront
$r = Invoke-Node @('swipe', '--serial', $phone1, '--log', $log, '--state', $st, '--myfiles', '--duration-ms', '300', '--dx', '100', '--dy', '0') $frontMf $adjFront -Keep
Test-Result 'MF-8 swipe --myfiles is refused' ($r.rc -eq '2' -and (Get-Calls).Count -eq 0) ('-> ' + $r.rc)
$r = Invoke-Node @('tap-home', '--serial', $phone1, '--log', $log, '--state', $st, '--myfiles', '--delay-ms', '100') $frontMf $adjFront -Keep
Test-Result 'MF-8 tap-home --myfiles is refused' ($r.rc -eq '2' -and (Get-Calls).Count -eq 0) ('-> ' + $r.rc)
$r = Invoke-Node @('--serial', $phone1, '--log', $log, '--myfiles', '--', 'shell', 'getprop') @{} @{}
Test-Result 'MF-8 adb call with --myfiles is refused' ($r.rc -eq '2' -and (Get-Calls).Count -eq 0) ('-> ' + $r.rc)
$badForms = [ordered]@{
    'with --id'          = @('pick', '--serial', $phone1, '--log', $log, '--state', $st, '--myfiles', '--id', 'com.android.documentsui:id/action_menu_select')
    'duplicate flag'     = @('pick', '--serial', $phone1, '--log', $log, '--state', $st, '--myfiles', '--myfiles', '--name', 'c128-card.png')
    'unknown option'     = @('pick', '--serial', $phone1, '--log', $log, '--state', $st, '--myfiles', '--name', 'c128-card.png', '--x', '1')
    'duplicate name'     = @('pick', '--serial', $phone1, '--log', $log, '--state', $st, '--myfiles', '--name', 'c128-card.png', '--name', 'Download')
    'adb section'        = @('pick', '--serial', $phone1, '--log', $log, '--state', $st, '--myfiles', '--name', 'c128-card.png', '--', 'shell', 'ls')
    'name is an option'  = @('pick', '--serial', $phone1, '--log', $log, '--state', $st, '--myfiles', '--name', '--state')
}
foreach ($k in $badForms.Keys) {
    $r = Invoke-Node $badForms[$k] $frontMf $adjFront
    Test-Result ('MF-8 pick --myfiles ' + $k) ($r.rc -eq '2' -and (Get-Calls).Count -eq 0) ('-> ' + $r.rc + ' calls=' + (Get-Calls).Count)
}

# MF-9: a no-match locks later picks exactly as for the other forms; plain pick --name and r15 intents stay as before.
$r = Invoke-Node (Get-PickArgs $phone1 'c128-missing.png') $frontMf $adjFront
$r2 = Invoke-Node (Get-PickArgs $phone1 'c128-card.png') $frontMf $adjFront -Keep
Test-Result 'MF-9 --myfiles no-match then locked' ($r.rc -eq '3' -and $r.out -eq 'no-match' -and $r2.rc -eq '98' -and (Get-Calls).Count -eq 0) ('-> ' + $r.rc + ' then ' + $r2.rc)
$r = Invoke-Node @('pick', '--serial', $phone2, '--log', $log, '--state', $st, '--name', 'c128-card.png') @{} @{}
Test-Result 'MF-9 plain pick --name on phone 2 is unchanged' ($r.rc -eq '0' -and (Get-Calls).Count -eq 1) ('-> ' + $r.rc)

foreach ($v in @('ADBG_FAKE_ADB_SCRIPT', 'FAKE_CALLS', 'FAKE_PIDS', 'FAKE_ADJ', 'FAKE_DUMP')) { Remove-Item Env:$v -ErrorAction SilentlyContinue }
Remove-Item -LiteralPath $testDir -Recurse -Force -ErrorAction SilentlyContinue
'failures=' + $script:failures
exit $script:failures
