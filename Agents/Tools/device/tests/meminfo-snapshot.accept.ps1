# Acceptance test of meminfo-snapshot.ps1 on the PC, no device: the tool runs as a child pwsh against a fake -AdbExe script that prints
# a real capture and records every argument line. Plain asserts print PASS/FAIL; exit 0 only if all hold.
#   pwsh -NoProfile -File Agents/Tools/device/tests/meminfo-snapshot.accept.ps1 [-SnapshotPath <another copy of the tool, for mutant runs>] [-ScratchBase <dir>]
#
# Fixture: a read-only capture from the maintainer's spare phone 2 (Android 10, SDK 29,
# Android System WebView 156.0.8078.47) taken with the app open and no tap, then sanitised: pids renumbered (app 1000, sandbox
# 2000), ProcessRecord hashes set to 0, uid tags rewritten to u0a999, uptime and the uid numbers replaced. The only package names
# kept are the app package, the WebView package prefix of the sandbox process and its service class, which the ownership and section
# logic need. In this capture the sandbox section has no GL mtrack row, and neither section has an EGL mtrack row; the parser
# reports such a row as null, never 0.
param(
    [string]$SnapshotPath,
    [string]$ScratchBase
)
$ErrorActionPreference = 'Stop'
if (-not $SnapshotPath) { $SnapshotPath = (Join-Path $PSScriptRoot '..\meminfo-snapshot.ps1') }
if (-not $ScratchBase) { $ScratchBase = Join-Path $env:TEMP 'risu-b715\meminfo-snapshot-accept' }
$work = Join-Path $ScratchBase ([guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $work | Out-Null
$staged = Join-Path $work 'tool'
New-Item -ItemType Directory -Force -Path $staged | Out-Null
Copy-Item -LiteralPath (Resolve-Path -LiteralPath $SnapshotPath).Path -Destination (Join-Path $staged 'meminfo-snapshot.ps1')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\lib.ps1') -Destination (Join-Path $staged 'lib.ps1')
$toolFile = Join-Path $staged 'meminfo-snapshot.ps1'
$pwshExe = (Get-Process -Id $PID).Path
$testSerial = 'TESTSERIAL01'

$script:failures = 0
function Assert-Check([bool]$Condition, [string]$Message) {
    if ($Condition) { Write-Output ('PASS ' + $Message) } else { Write-Output ('FAIL ' + $Message); $script:failures++ }
}

$activityFixture = @'
  *APP* UID 10999 ProcessRecord{0 1000:io.github.yor42.risutanium/u0a999}
  *APP* UID 99999 ProcessRecord{0 2000:com.google.android.webview:sandboxed_process0:org.chromium.content.app.SandboxedProcessService0:0/u0a999i182}
    Isolated #0: ProcessRecord{0 2000:com.google.android.webview:sandboxed_process0:org.chromium.content.app.SandboxedProcessService0:0/u0a999i182}
    PID #2000: ProcessRecord{0 2000:com.google.android.webview:sandboxed_process0:org.chromium.content.app.SandboxedProcessService0:0/u0a999i182}
    PID #1000: ProcessRecord{0 1000:io.github.yor42.risutanium/u0a999}
  mPreviousProcess: ProcessRecord{0 1000:io.github.yor42.risutanium/u0a999}
'@

$meminfoFixture = @'
Applications Memory Usage (in Kilobytes):
Uptime: 1 Realtime: 1

** MEMINFO in pid 2000 [com.google.android.webview:sandboxed_process0:org.chromium.content.app.SandboxedProcessService0:0] **
                   Pss  Private  Private  SwapPss     Heap     Heap     Heap
                 Total    Dirty    Clean    Dirty     Size    Alloc     Free
                ------   ------   ------   ------   ------   ------   ------
  Native Heap     1680     1620       40      150     6780     5921      858
  Dalvik Heap      428      424        0       27     3116     1084     2032
 Dalvik Other      279      268        8        4
        Stack       32       32        0        0
       Ashmem      596      388        0        0
    Other dev       13        0       12        0
     .so mmap      122       24        4       23
    .jar mmap       84        0        0        0
    .apk mmap    65116      244    46860      120
    .ttf mmap     2891        0     2548        0
    .dex mmap      971        0       28        2
    .oat mmap       90        0        0        0
    .art mmap      606      460       24      240
   Other mmap     2884       20     2140        0
      Unknown    51273    51192       68       42
        TOTAL   127673    54672    51732      608     9896     7005     2890

 App Summary
                       Pss(KB)
                        ------
           Java Heap:      908
         Native Heap:     1620
                Code:    49708
               Stack:       32
            Graphics:        0
       Private Other:    54136
              System:    21269

               TOTAL:   127673       TOTAL SWAP PSS:      608

 Objects
               Views:        0         ViewRootImpl:        0
         AppContexts:        3           Activities:        0
              Assets:       14        AssetManagers:        0
       Local Binders:        3        Proxy Binders:        6
       Parcel memory:        7         Parcel count:       28
    Death Recipients:        0      OpenSSL Sockets:        0
            WebViews:        0

 SQL
         MEMORY_USED:        0
  PAGECACHE_OVERFLOW:        0          MALLOC_SIZE:        0


** MEMINFO in pid 1000 [io.github.yor42.risutanium] **
                   Pss  Private  Private  SwapPss     Heap     Heap     Heap
                 Total    Dirty    Clean    Dirty     Size    Alloc     Free
                ------   ------   ------   ------   ------   ------   ------
  Native Heap    34627    34488       28      127    42092    37836     4255
  Dalvik Heap     3232     3212        0       23     5794     3762     2032
 Dalvik Other     2431     2428        0        0
        Stack      116      116        0        0
       Ashmem      346      200        0        0
    Other dev       22        0       20        0
     .so mmap    10119     1928     3048        1
    .jar mmap     3972        0     2224        0
    .apk mmap    61747     1628    40724        0
    .ttf mmap      260        0      156        0
    .dex mmap    19029    14736     2428        0
    .oat mmap       82        0       24        0
    .art mmap     7264     6824      156       26
   Other mmap     2009      164      940        0
    GL mtrack     5660     5660        0        0
      Unknown    13694    13648       32        0
        TOTAL   164787    85032    49780      177    47886    41598     6287

 App Summary
                       Pss(KB)
                        ------
           Java Heap:    10192
         Native Heap:    34488
                Code:    66896
               Stack:      116
            Graphics:     5660
       Private Other:    17460
              System:    29975

               TOTAL:   164787       TOTAL SWAP PSS:      177

 Objects
               Views:       10         ViewRootImpl:        1
         AppContexts:        8           Activities:        1
              Assets:       17        AssetManagers:        0
       Local Binders:       27        Proxy Binders:       45
       Parcel memory:       14         Parcel count:       58
    Death Recipients:        3      OpenSSL Sockets:        0
            WebViews:        1

 SQL
         MEMORY_USED:        0
  PAGECACHE_OVERFLOW:        0          MALLOC_SIZE:        0

'@

$fakeAdbSource = @'
$lineText = $args -join ' '
Add-Content -LiteralPath $env:FAKE_CALLS -Value $lineText
if ($args[2] -eq 'shell' -and $args[3] -eq 'pidof') { if ($env:FAKE_APP_PID) { $env:FAKE_APP_PID }; exit 0 }
if ($args[3] -eq 'dumpsys' -and $args[4] -eq 'activity') { Get-Content -LiteralPath $env:FAKE_ACTIVITY; exit 0 }
if ($args[3] -eq 'dumpsys' -and $args[4] -eq 'meminfo' -and $args[5] -eq '--package') { Get-Content -LiteralPath $env:FAKE_MEMINFO; exit 0 }
'unexpected call'
exit 0
'@
$fakeAdb = Join-Path $work 'fake-adb.ps1'
Set-Content -LiteralPath $fakeAdb -Value $fakeAdbSource -Encoding ascii

$runCounter = 0
function Invoke-Snapshot([string[]]$ToolArguments, [string]$ActivityText = $activityFixture, [string]$MeminfoText = $meminfoFixture, [string]$AppPid = '1000') {
    $script:runCounter++
    $name = 'run' + $script:runCounter
    $callsFile = Join-Path $work ($name + '.calls')
    $activityFile = Join-Path $work ($name + '.activity')
    $meminfoFile = Join-Path $work ($name + '.meminfo')
    Set-Content -LiteralPath $activityFile -Value $ActivityText -Encoding ascii
    Set-Content -LiteralPath $meminfoFile -Value $MeminfoText -Encoding ascii
    $env:FAKE_CALLS = $callsFile
    $env:FAKE_ACTIVITY = $activityFile
    $env:FAKE_MEMINFO = $meminfoFile
    $env:FAKE_APP_PID = $AppPid
    $output = @(& $pwshExe -NoProfile -File $toolFile @ToolArguments 2>&1)
    $code = $LASTEXITCODE
    $calls = @()
    if (Test-Path -LiteralPath $callsFile) { $calls = @(Get-Content -LiteralPath $callsFile) }
    $text = ($output -join "`n")
    $json = $null
    try { $json = $text | ConvertFrom-Json } catch { $json = $null }
    return [pscustomobject]@{ Code = $code; Output = $text; Json = $json; Calls = $calls }
}
$deviceArguments = @('-Serial', $testSerial, '-Label', 'accept', '-AdbExe', $fakeAdb)

# Independent reader of the fixture text: finds a header by pid, then the first row with the exact label after it. It shares no code with the tool.
function Read-ByLabel([string]$Text, [string]$HeaderPid, [string]$RowLabel, [int]$Group) {
    $lines = $Text -split "`r?`n"
    $start = -1
    for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i].StartsWith('** MEMINFO in pid ' + $HeaderPid + ' ')) { $start = $i } }
    if ($start -lt 0) { return $null }
    for ($i = $start + 1; $i -lt $lines.Count; $i++) {
        if ($lines[$i].StartsWith('** MEMINFO')) { return $null }
        $m = [regex]::Match($lines[$i], '^\s*' + [regex]::Escape($RowLabel) + '\s+(\d+)\s+(\d+)')
        if ($m.Success -and $RowLabel -match 'mtrack') { return [long]$m.Groups[$Group].Value }
        $s = [regex]::Match($lines[$i], '^\s*' + [regex]::Escape($RowLabel) + ':\s+(\d+)')
        if ($s.Success -and $RowLabel -notmatch 'mtrack') { return [long]$s.Groups[1].Value }
    }
    return $null
}

# T8 the real capture gives the independently read numbers for both processes, and null for the rows that capture lacks
$run = Invoke-Snapshot $deviceArguments
Assert-Check ($run.Code -eq 0 -and $null -ne $run.Json) ('T8 exit 0 and one JSON line (exit ' + $run.Code + ')')
if ($null -ne $run.Json) {
    $names = [ordered]@{ javaHeapKb = 'Java Heap'; nativeHeapKb = 'Native Heap'; graphicsKb = 'Graphics'; privateOtherKb = 'Private Other'; systemKb = 'System'; totalPssKb = 'TOTAL' }
    foreach ($process in @(@('app', '1000'), @('sandbox', '2000'))) {
        $okAll = $true
        foreach ($field in $names.Keys) {
            $expected = Read-ByLabel $meminfoFixture $process[1] $names[$field] 1
            if ($run.Json.($process[0]).$field -ne $expected -or $null -eq $expected) { $okAll = $false }
        }
        Assert-Check $okAll ('T8 ' + $process[0] + ': the six App Summary fields equal the values read independently by label')
        $glPss = Read-ByLabel $meminfoFixture $process[1] 'GL mtrack' 1
        $glDirty = Read-ByLabel $meminfoFixture $process[1] 'GL mtrack' 2
        Assert-Check ($run.Json.($process[0]).glMtrackPssKb -eq $glPss -and $run.Json.($process[0]).glMtrackPrivateDirtyKb -eq $glDirty) ('T8 ' + $process[0] + ': GL mtrack Pss Total and Private Dirty equal the independent read (' + $glPss + '/' + $glDirty + ')')
    }
    Assert-Check ($run.Json.app.totalPssKb -eq 164787 -and $run.Json.sandbox.totalPssKb -eq 127673 -and $run.Json.app.graphicsKb -eq 5660 -and $run.Json.app.glMtrackPrivateDirtyKb -eq 5660) 'T8 literal values: app total 164787 and sandbox total 127673, app Graphics and GL mtrack 5660'
    Assert-Check ($null -eq $run.Json.sandbox.glMtrackPssKb -and $null -eq $run.Json.app.eglMtrackPssKb -and $null -eq $run.Json.sandbox.eglMtrackPrivateDirtyKb) 'T8 the rows the capture lacks (sandbox GL mtrack, both EGL mtrack) are null'
    Assert-Check ($run.Json.complete -eq $true -and (@($run.Json.missing) -contains 'sandbox.glMtrackPssKb') -and (@($run.Json.missing) -contains 'app.eglMtrackPssKb') -and @($run.Json.missing).Count -eq 6) 'T8 complete is true (six summary fields in both processes) and missing names exactly the six absent mtrack fields'
}
Assert-Check ($run.Output -notmatch 'risutanium|sandboxed|webview|yor42|chromium') 'T8 the output holds no package or process name'
Assert-Check ($run.Calls.Count -gt 0 -and @($run.Calls | Where-Object { -not $_.StartsWith('-s ' + $testSerial + ' ') }).Count -eq 0) 'T8 every adb call is -s <serial> first'
Assert-Check (@($run.Calls | Where-Object { $_ -like '*meminfo --package io.github.yor42.risutanium' }).Count -eq 1 -and @($run.Calls | Where-Object { $_ -like '*dumpsys activity processes' }).Count -eq 1) 'T8 one activity-processes read and one --package listing per snapshot'

# T8b a missing row is null and named, never 0
$appStart = $meminfoFixture.IndexOf('** MEMINFO in pid 1000 ')
$appTail = $meminfoFixture.Substring($appStart)
$withoutGraphics = $meminfoFixture.Substring(0, $appStart) + (($appTail -split "`r?`n" | Where-Object { $_ -notmatch '^\s*Graphics:' }) -join "`n")
$run = Invoke-Snapshot $deviceArguments $activityFixture $withoutGraphics
Assert-Check ($run.Code -eq 0 -and $null -ne $run.Json -and $null -eq $run.Json.app.graphicsKb -and (@($run.Json.missing) -contains 'app.graphicsKb') -and $run.Json.complete -eq $false) 'T8b Graphics row removed: app.graphicsKb is null, listed in missing, complete is false'
Assert-Check ($null -ne $run.Json -and $run.Json.app.totalPssKb -eq 164787 -and $run.Json.app.systemKb -eq 29975 -and $run.Json.sandbox.graphicsKb -eq 0) 'T8b Graphics row removed: the other app fields and the sandbox Graphics 0 are unchanged'
$withoutGl = $meminfoFixture.Substring(0, $appStart) + (($appTail -split "`r?`n" | Where-Object { $_ -notmatch '^\s*GL mtrack' }) -join "`n")
$run = Invoke-Snapshot $deviceArguments $activityFixture $withoutGl
Assert-Check ($run.Code -eq 0 -and $null -ne $run.Json -and $null -eq $run.Json.app.glMtrackPssKb -and $null -eq $run.Json.app.glMtrackPrivateDirtyKb -and (@($run.Json.missing) -contains 'app.glMtrackPssKb') -and $run.Json.app.graphicsKb -eq 5660) 'T8b GL mtrack row removed: both GL fields are null and listed in missing, Graphics unchanged'

# T8c the table columns are found by header name: swap Pss Total and Private Dirty (header words and values together)
function Swap-FirstTwoColumns([string]$SectionText) {
    $out = foreach ($line in ($SectionText -split "`r?`n")) {
        if ($line -match '^\s+Pss\s+Private\s+Private\s+SwapPss') { '                Private      Pss  Private  SwapPss     Heap     Heap     Heap' }
        elseif ($line -match '^\s+Total\s+Dirty\s+Clean\s+Dirty') { '                 Dirty    Total    Clean    Dirty     Size    Alloc     Free' }
        elseif ($line -match '^\s*(\S.*?)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)((?:\s+\d+){0,3})\s*$' -and $line -notmatch ':') {
            $m = [regex]::Match($line, '^\s*(\S.*?)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)((?:\s+\d+){0,3})\s*$')
            '  ' + $m.Groups[1].Value + '  ' + $m.Groups[3].Value + ' ' + $m.Groups[2].Value + ' ' + $m.Groups[4].Value + ' ' + $m.Groups[5].Value + $m.Groups[6].Value
        } else { $line }
    }
    return ($out -join "`n")
}
$swapped = Swap-FirstTwoColumns $meminfoFixture
Assert-Check ($swapped -ne $meminfoFixture -and $swapped -match 'GL mtrack  5660 5660 0 0') 'T8c the swapped fixture really differs (header words and a GL row)'
$run = Invoke-Snapshot $deviceArguments $activityFixture $swapped
$swapJson = $run.Json
$unswapped = Invoke-Snapshot $deviceArguments
Assert-Check ($null -ne $swapJson -and $swapJson.app.glMtrackPssKb -eq 5660 -and $swapJson.app.glMtrackPrivateDirtyKb -eq 5660 -and ($swapJson | ConvertTo-Json -Compress -Depth 4) -eq ($unswapped.Json | ConvertTo-Json -Compress -Depth 4)) 'T8c with Pss Total and Private Dirty swapped the snapshot equals the unswapped one'
$distinct = $meminfoFixture -replace 'GL mtrack     5660     5660', 'GL mtrack     5660     1234'
$run = Invoke-Snapshot $deviceArguments $activityFixture (Swap-FirstTwoColumns $distinct)
Assert-Check ($null -ne $run.Json -and $run.Json.app.glMtrackPssKb -eq 5660 -and $run.Json.app.glMtrackPrivateDirtyKb -eq 1234) 'T8c a GL row with different Pss Total (5660) and Private Dirty (1234) keeps them apart after the swap'

# T9 ownership: DROP and no numbers
function Assert-Drop($Run, [string]$Reason, [string]$Message) {
    Assert-Check ($Run.Code -eq 3 -and $null -ne $Run.Json -and $Run.Json.drop -eq $Reason -and $null -eq $Run.Json.app -and $Run.Output -notmatch '\d{4,}') ('T9 ' + $Message + ' (exit ' + $Run.Code + ', drop ' + $(if ($null -ne $Run.Json) { $Run.Json.drop } else { 'n/a' }) + ')')
}
$foreignTag = $activityFixture -replace 'u0a999i182', 'u0a998i182'
Assert-Drop (Invoke-Snapshot $deviceArguments $foreignTag) 'owner' 'a sandbox_process pid with a foreign uid tag in its ProcessRecord is not owned'
$noSandbox = (($activityFixture -split "`r?`n") | Where-Object { $_ -notmatch 'sandboxed_process' }) -join "`n"
Assert-Drop (Invoke-Snapshot $deviceArguments $noSandbox) 'owner' 'zero owned sandbox pids'
$secondOwned = $activityFixture + "`n" + '    PID #2001: ProcessRecord{0 2001:com.google.android.webview:sandboxed_process1:org.chromium.content.app.SandboxedProcessService1:0/u0a999i183}'
Assert-Drop (Invoke-Snapshot $deviceArguments $secondOwned) 'owner' 'two owned sandbox pids'
$noRecord = (($activityFixture -split "`r?`n") | Where-Object { $_ -notmatch 'io.github.yor42.risutanium' }) -join "`n"
Assert-Drop (Invoke-Snapshot $deviceArguments $noRecord) 'owner' 'no ProcessRecord of the app, so the uid tag is unknown'
Assert-Drop (Invoke-Snapshot $deviceArguments $activityFixture $meminfoFixture '') 'app' 'no app pid'
$renamedSection = $meminfoFixture -replace 'sandboxed_process0', 'other_process0'
Assert-Drop (Invoke-Snapshot $deviceArguments $activityFixture $renamedSection) 'sandbox-section' 'the owned pid has no sandboxed_process section in the listing'
$firstPidOnly = $meminfoFixture -replace '\*\* MEMINFO in pid 2000 ', '** MEMINFO in pid 2999 '
Assert-Drop (Invoke-Snapshot $deviceArguments $activityFixture $firstPidOnly) 'sandbox-section' 'the listing holds no section for the owned pid (another sandbox pid comes first)'

# T10 refused arguments exit 2 before any adb call
foreach ($bad in @(@('-Serial', '', '-Label', 'x'), @('-Serial', '   ', '-Label', 'x'), @('-Serial', 'bad serial!', '-Label', 'x'), @('-Serial', 'OTHER', '-AllowedSerials', 'A,B', '-Label', 'x'), @('-Serial', $testSerial), @('-Serial', $testSerial, '-Label', 'has space'), @('-Serial', $testSerial, '-ChromePid', '4', '-Label', 'x'))) {
    $run = Invoke-Snapshot ($bad + @('-AdbExe', $fakeAdb))
    Assert-Check ($run.Code -eq 2 -and $run.Calls.Count -eq 0) ('T10 refused arguments exit 2 with no adb call: ' + ($bad -join ' '))
}

# T10 Chrome mode
$browserPid = 4000
function New-ProcessEntry([int]$ProcessId, [int]$ParentId, [string]$CommandLine, $PrivateBytes) { return [ordered]@{ ProcessId = $ProcessId; ParentProcessId = $ParentId; CommandLine = $CommandLine; PrivateBytes = $PrivateBytes } }
function Invoke-ChromeSnapshot($Entries, [string]$Name) {
    $file = Join-Path $work ($Name + '.json')
    Set-Content -LiteralPath $file -Value (ConvertTo-Json -InputObject @($Entries) -Depth 3) -Encoding ascii
    $output = @(& $pwshExe -NoProfile -File $toolFile -ChromePid $browserPid -Label chrome -ProcessListJson $file 2>&1)
    $code = $LASTEXITCODE
    $text = ($output -join "`n")
    $json = $null
    try { $json = $text | ConvertFrom-Json } catch { $json = $null }
    return [pscustomobject]@{ Code = $code; Output = $text; Json = $json }
}
$gpuEntry = New-ProcessEntry 4002 $browserPid 'chrome.exe --type=gpu-process --gpu-preferences=x' 300000000
$rendererEntry = New-ProcessEntry 4001 $browserPid 'chrome.exe --type=renderer --first-renderer-process' 800000000
$extensionEntry = New-ProcessEntry 4003 $browserPid 'chrome.exe --type=renderer --extension-process' 111000000
$otherParent = New-ProcessEntry 4004 3999 'chrome.exe --type=renderer' 222000000
$run = Invoke-ChromeSnapshot @($rendererEntry, $gpuEntry, $extensionEntry, $otherParent) 'chrome-one'
Assert-Check ($run.Code -eq 0 -and $null -ne $run.Json -and $run.Json.mode -eq 'chrome' -and $run.Json.rendererPrivateBytes -eq 800000000 -and $run.Json.gpuPrivateBytes -eq 300000000) 'T10 one renderer (an extension renderer and a renderer of another parent are ignored) and one GPU process give their private bytes'
$run = Invoke-ChromeSnapshot @($gpuEntry, $extensionEntry) 'chrome-zero'
Assert-Check ($run.Code -eq 3 -and $null -ne $run.Json -and $run.Json.drop -eq 'renderer' -and $run.Output -notmatch '\d{6,}') 'T10 zero renderers give DROP and no numbers'
$secondRenderer = New-ProcessEntry 4005 $browserPid 'chrome.exe --type=renderer' 700000000
$run = Invoke-ChromeSnapshot @($rendererEntry, $secondRenderer, $gpuEntry) 'chrome-two'
Assert-Check ($run.Code -eq 3 -and $null -ne $run.Json -and $run.Json.drop -eq 'renderer' -and $run.Output -notmatch '\d{6,}') 'T10 two renderers give DROP, the first is not picked'
$run = Invoke-ChromeSnapshot @($rendererEntry) 'chrome-nogpu'
Assert-Check ($run.Code -eq 3 -and $null -ne $run.Json -and $run.Json.drop -eq 'gpu') 'T10 no GPU process gives DROP'

Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
Write-Output ($(if ($script:failures -eq 0) { 'ALL PASSED' } else { 'FAILED: ' + $script:failures }))
exit ([int]($script:failures -ne 0))
