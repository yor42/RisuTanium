# One settled memory snapshot, one JSON line on stdout. Numbers and the label only: no package, process or path name is printed.
#   Phone:  pwsh -NoProfile -File meminfo-snapshot.ps1 -Serial <adb serial> -Label <text> [-Package <id>] [-AllowedSerials <a,b>] [-AdbExe <path>]
#   PC:     pwsh -NoProfile -File meminfo-snapshot.ps1 -ChromePid <browser pid> -Label <text>
# Phone line: {"label","mode":"device","complete","app":{...},"sandbox":{...},"missing":[...]}. Each of app and sandbox holds javaHeapKb,
# nativeHeapKb, graphicsKb, privateOtherKb, systemKb, totalPssKb (App Summary rows) and glMtrackPssKb, glMtrackPrivateDirtyKb,
# eglMtrackPssKb, eglMtrackPrivateDirtyKb (table rows). A row or column that is absent is null and named in "missing"; it is never 0.
# "complete" is true when the six App Summary fields are present for both processes; the mtrack rows exist only for a process that
# has GL memory, so their absence does not make a snapshot incomplete.
# PC line: {"label","mode":"chrome","rendererPrivateBytes","gpuPrivateBytes"}.
#
# Invariants:
# - -Serial is mandatory in device mode: an empty or malformed value, or one outside -AllowedSerials when that list is given, exits 2
#   before the first adb call. Every adb call is `adb -s <serial> ...`.
# - The sandbox is the isolated pid whose uid tag in `dumpsys activity processes` belongs to the app's own uid tag (Get-OwnedSandboxPids
#   of lib.ps1), never the first sandboxed_process header and never a pgrep match. Anything other than exactly one owned sandbox pid
#   whose section is present in `dumpsys meminfo --package <Package>` gives a DROP line and exit 3, with no numbers.
# - Sections are split on the `** MEMINFO in pid N [...] **` headers. Table columns are located by their header names (Pss Total,
#   Private Dirty), never by fixed offsets; App Summary rows are matched by their exact labels.
# - Chrome mode: exactly one --type=renderer child (not an --extension-process one) and exactly one --type=gpu-process child of the
#   browser pid, otherwise a DROP line and exit 3. The renderer-minus-JS-heap difference is the caller's.
# Exit codes: 0 snapshot written, 2 refused arguments, 3 DROP.
# -ProcessListJson exists for the acceptance test: a JSON array of {ProcessId, ParentProcessId, CommandLine, PrivateBytes} replaces the
# Windows process query.
param(
    [string]$Serial = '',
    [string]$Label = '',
    [string]$Package = 'io.github.yor42.risutanium',
    [int]$ChromePid = 0,
    [string[]]$AllowedSerials = @(),
    [string]$AdbExe = 'adb',
    [string]$ProcessListJson = ''
)

function Stop-SnapshotRefused([string]$Reason) {
    [Console]::Error.WriteLine('meminfo-snapshot: ' + $Reason)
    exit 2
}

function Write-SnapshotDrop([string]$Reason) {
    Write-Output ((@{ label = $Label; drop = $Reason }) | ConvertTo-Json -Compress)
    exit 3
}

if ($Label -notmatch '^[A-Za-z0-9._-]{1,64}$') { Stop-SnapshotRefused '-Label is required: 1 to 64 characters from A-Z a-z 0-9 . _ -' }
$chromeMode = ($ChromePid -gt 0)
if ($chromeMode -and $Serial -ne '') { Stop-SnapshotRefused '-Serial and -ChromePid are two separate modes' }
if (-not $chromeMode) {
    if ([string]::IsNullOrWhiteSpace($Serial)) { Stop-SnapshotRefused '-Serial is required (or -ChromePid)' }
    if ($Serial -notmatch '^[A-Za-z0-9._:-]+$') { Stop-SnapshotRefused '-Serial has characters an adb serial does not have' }
    if ($AllowedSerials.Count -gt 0 -and ($AllowedSerials -notcontains $Serial)) { Stop-SnapshotRefused '-Serial is not in -AllowedSerials' }
    if ($Package -notmatch '^[A-Za-z0-9._]+$') { Stop-SnapshotRefused '-Package is not a package id' }
}

if ($chromeMode) {
    if ($ProcessListJson -ne '') {
        $processes = @(Get-Content -LiteralPath $ProcessListJson -Raw | ConvertFrom-Json)
    } else {
        $processes = @(Get-CimInstance Win32_Process -Filter ('ParentProcessId=' + $ChromePid) | ForEach-Object {
            $privateBytes = $null
            try { $privateBytes = (Get-Process -Id $_.ProcessId -ErrorAction Stop).PrivateMemorySize64 } catch { $privateBytes = $null }
            [pscustomobject]@{ ProcessId = $_.ProcessId; ParentProcessId = $_.ParentProcessId; CommandLine = $_.CommandLine; PrivateBytes = $privateBytes }
        })
    }
    $children = @($processes | Where-Object { [int]$_.ParentProcessId -eq $ChromePid })
    $renderers = @($children | Where-Object { $_.CommandLine -match '--type=renderer(\s|$)' -and $_.CommandLine -notmatch '--extension-process' })
    $gpus = @($children | Where-Object { $_.CommandLine -match '--type=gpu-process(\s|$)' })
    if ($renderers.Count -ne 1) { Write-SnapshotDrop 'renderer' }
    if ($gpus.Count -ne 1) { Write-SnapshotDrop 'gpu' }
    if ($null -eq $renderers[0].PrivateBytes -or $null -eq $gpus[0].PrivateBytes) { Write-SnapshotDrop 'private-bytes' }
    $line = [ordered]@{ label = $Label; mode = 'chrome'; rendererPrivateBytes = [long]$renderers[0].PrivateBytes; gpuPrivateBytes = [long]$gpus[0].PrivateBytes }
    Write-Output ($line | ConvertTo-Json -Compress)
    exit 0
}

. (Join-Path $PSScriptRoot 'lib.ps1')

function Invoke-SnapshotAdb([string[]]$AdbArgs) {
    return @(& $AdbExe -s $Serial @AdbArgs 2>$null)
}

function ConvertTo-SnapshotNumber([string]$Text) {
    return [long]($Text -replace ',', '')
}

# Splits the --package listing into @{ Pid; Name; Lines } sections.
function Split-MeminfoSections([string[]]$Lines) {
    $sections = @()
    $current = $null
    foreach ($line in $Lines) {
        $header = [regex]::Match($line, '^\*\* MEMINFO in pid (\d+) \[([^\]]*)\] \*\*')
        if ($header.Success) {
            $current = @{ Pid = [int]$header.Groups[1].Value; Name = $header.Groups[2].Value; Lines = @() }
            $sections += , $current
        } elseif ($null -ne $current) {
            $current.Lines += $line
        }
    }
    return $sections
}

$summaryLabels = [ordered]@{
    javaHeapKb = 'Java Heap'; nativeHeapKb = 'Native Heap'; graphicsKb = 'Graphics'; privateOtherKb = 'Private Other'; systemKb = 'System'
}

# Returns @{ Values = <ordered name -> long or $null>; Missing = <names> } for one section.
function Read-MeminfoSection([string[]]$Lines, [string]$Prefix) {
    $values = [ordered]@{}
    $missing = @()
    # App Summary rows by exact label
    $summaryStart = -1
    for ($i = 0; $i -lt $Lines.Count; $i++) { if ($Lines[$i] -match '^\s*App Summary\s*$') { $summaryStart = $i; break } }
    $summaryRows = @{}
    if ($summaryStart -ge 0) {
        for ($i = $summaryStart + 1; $i -lt $Lines.Count; $i++) {
            if ($Lines[$i] -match '^\s*Objects\s*$') { break }
            $m = [regex]::Match($Lines[$i], '^\s*([A-Za-z ]+):\s+(\d[\d,]*)\s*$')
            if ($m.Success) { $summaryRows[$m.Groups[1].Value] = ConvertTo-SnapshotNumber $m.Groups[2].Value }
            $t = [regex]::Match($Lines[$i], '^\s*TOTAL:\s+(\d[\d,]*)\s+TOTAL SWAP PSS:\s+(\d[\d,]*)\s*$')
            if ($t.Success) { $summaryRows['TOTAL'] = ConvertTo-SnapshotNumber $t.Groups[1].Value }
        }
    }
    foreach ($name in $summaryLabels.Keys) {
        $key = $summaryLabels[$name]
        if ($summaryRows.ContainsKey($key)) { $values[$name] = $summaryRows[$key] } else { $values[$name] = $null; $missing += ($Prefix + '.' + $name) }
    }
    if ($summaryRows.ContainsKey('TOTAL')) { $values['totalPssKb'] = $summaryRows['TOTAL'] } else { $values['totalPssKb'] = $null; $missing += ($Prefix + '.totalPssKb') }
    # table: the column names come from the two header lines that sit right above the dashed rule
    $columns = @()
    $tableStart = -1
    for ($i = 0; $i + 2 -lt $Lines.Count; $i++) {
        if ($Lines[$i + 2] -match '^\s*-+(\s+-+)+\s*$' -and $Lines[$i] -match '^\s*[A-Za-z]+(\s+[A-Za-z]+)+\s*$' -and $Lines[$i + 1] -match '^\s*[A-Za-z]+(\s+[A-Za-z]+)+\s*$') {
            $first = @($Lines[$i].Trim() -split '\s+')
            $second = @($Lines[$i + 1].Trim() -split '\s+')
            if ($first.Count -eq $second.Count) {
                for ($c = 0; $c -lt $first.Count; $c++) { $columns += ($first[$c] + ' ' + $second[$c]) }
                $tableStart = $i + 3
            }
            break
        }
    }
    $pssIndex = [array]::IndexOf($columns, 'Pss Total')
    $dirtyIndex = [array]::IndexOf($columns, 'Private Dirty')
    $tableRows = @{}
    if ($tableStart -ge 0) {
        for ($i = $tableStart; $i -lt $Lines.Count; $i++) {
            if ($Lines[$i] -match '^\s*$' -or $Lines[$i] -match 'App Summary') { break }
            $m = [regex]::Match($Lines[$i], '^\s*(\S.*?)\s+(-?[\d,]+(?:\s+-?[\d,]+)*)\s*$')
            if ($m.Success) { $tableRows[$m.Groups[1].Value] = @($m.Groups[2].Value -split '\s+' | ForEach-Object { ConvertTo-SnapshotNumber $_ }) }
        }
    }
    foreach ($pair in @(@('glMtrack', 'GL mtrack'), @('eglMtrack', 'EGL mtrack'))) {
        foreach ($column in @(@('PssKb', $pssIndex), @('PrivateDirtyKb', $dirtyIndex))) {
            $name = $pair[0] + $column[0]
            $index = [int]$column[1]
            if ($tableRows.ContainsKey($pair[1]) -and $index -ge 0 -and $index -lt $tableRows[$pair[1]].Count) { $values[$name] = $tableRows[$pair[1]][$index] }
            else { $values[$name] = $null; $missing += ($Prefix + '.' + $name) }
        }
    }
    return @{ Values = $values; Missing = $missing }
}

$appPidText = ((Invoke-SnapshotAdb @('shell', 'pidof', $Package)) -join ' ').Trim().Split(' ')[0]
if ($appPidText -notmatch '^\d+$') { Write-SnapshotDrop 'app' }
$appPid = [int]$appPidText
$activityText = (Invoke-SnapshotAdb @('shell', 'dumpsys', 'activity', 'processes')) -join "`n"
$owner = Get-OwnedSandboxPids -Text $activityText -AppPids @($appPid)
if (-not $owner.Known -or @($owner.Pids).Count -ne 1) { Write-SnapshotDrop 'owner' }
$sandboxPid = [int]@($owner.Pids)[0]
$sections = Split-MeminfoSections (Invoke-SnapshotAdb @('shell', 'dumpsys', 'meminfo', '--package', $Package))
$appSection = @($sections | Where-Object { $_.Pid -eq $appPid })
$sandboxSection = @($sections | Where-Object { $_.Pid -eq $sandboxPid -and $_.Name -match 'sandboxed_process\d+' })
if ($appSection.Count -ne 1) { Write-SnapshotDrop 'app-section' }
if ($sandboxSection.Count -ne 1) { Write-SnapshotDrop 'sandbox-section' }
$appRead = Read-MeminfoSection ([string[]]$appSection[0].Lines) 'app'
$sandboxRead = Read-MeminfoSection ([string[]]$sandboxSection[0].Lines) 'sandbox'
$missingAll = @($appRead.Missing) + @($sandboxRead.Missing)
$summaryNames = @($summaryLabels.Keys) + @('totalPssKb')
$complete = $true
foreach ($name in $summaryNames) { if ($null -eq $appRead.Values[$name] -or $null -eq $sandboxRead.Values[$name]) { $complete = $false } }
$line = [ordered]@{
    label = $Label; mode = 'device'; complete = $complete
    app = $appRead.Values; sandbox = $sandboxRead.Values; missing = @($missingAll)
}
Write-Output ($line | ConvertTo-Json -Compress -Depth 4)
exit 0
