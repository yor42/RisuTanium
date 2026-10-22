# Takes a whole-app-data snapshot of the test profile (debug builds only) and writes <OutDir>\result.json.
# The app is force-stopped first so the files are consistent, then the app data dir is archived from inside the app uid
# (run-as ... tar) over adb exec-out into a file by process redirection, never a pipe. cache, code_cache and lib are not part of
# a snapshot. The snapshot lives in <SnapshotRoot>\<Profile>\<Id>\ as snapshot.tar plus snapshot.json (the manifest, written last).
# The manifest records the build identity (versionCode, signing digest), the tar SHA-256, the per-entry byte sums (and du
# totals, informational) and the file count that restore-snapshot.ps1 checks. A release build is refused: run-as does not work for it.
# Size: a warning above -WarnBytes (recorded in the result and printed), a refusal above -RefuseBytes, before and during the copy.
# The newest -Keep unpinned snapshots of a profile are kept; -Pin marks this one as never pruned.
param(
    [Parameter(Mandatory)][string]$OutDir,
    [Parameter(Mandatory)][string]$Id,
    [string]$Profile = 'test',
    [string]$SnapshotRoot,
    [switch]$Pin,
    [string]$ProducedBy = 'manual',
    [int64]$WarnBytes = 2147483648,
    [int64]$RefuseBytes = 4294967296,
    [ValidateRange(1, 50)][int]$Keep = 3,
    [string]$Serial,
    [string[]]$AllowedSerials,
    [string]$Package,
    [ValidateRange(1, 1800)][int]$MaxSeconds = 1500,
    [string]$RepoRoot,
    [string]$AdbExe
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib.ps1')
Disable-StdHandleInherit
if (-not $RepoRoot) { $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path }
if (-not $Serial) { $Serial = $script:DefaultSerial }
if (-not $AllowedSerials) { $AllowedSerials = @($script:DefaultSerial) }
if (-not $Package) { $Package = $script:DefaultPackage }
if (-not $SnapshotRoot) { $SnapshotRoot = Join-Path $script:ScratchRoot 'device-snapshots' }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$resultPath = Join-Path $OutDir 'result.json'
$deadline = (Get-Date).AddSeconds($MaxSeconds)
$r = New-Result -CheckId 'snapshot' -BuildKind 'none' -CapSec $MaxSeconds -Repo $RepoRoot -Serial $Serial
$r.warnings = @()
$r.transfer = $null
$lockPath = Join-Path $SnapshotRoot ('device-' + $Serial + '.lock')
$haveLock = $false
$snapCreated = $false
$phase = $null

function Start-Phase([string]$Name) { $script:phase = @{ name = $Name; t = Get-Date } }
function End-Phase([string]$Note) {
    $e = Get-Date
    $script:r.phases += [ordered]@{ name = $script:phase.name; startedAt = (ConvertTo-IsoTime $script:phase.t); endedAt = (ConvertTo-IsoTime $e)
        durationSec = [math]::Round(($e - $script:phase.t).TotalSeconds, 2); note = $Note }
}
function Get-Remaining { return [int][math]::Floor(($script:deadline - (Get-Date)).TotalSeconds) }
function Finish([string]$Verdict, [string]$Reason) {
    # A failed run removes the half-written snapshot directory it created; one with a manifest is complete and stays, and a directory this run did not create is never touched.
    if ($Verdict -ne 'pass' -and $script:snapDir -and $script:snapCreated -and (Test-Path -LiteralPath $script:snapDir) -and -not (Test-Path -LiteralPath (Join-Path $script:snapDir 'snapshot.json')) `
        -and (Split-Path -Parent $script:snapDir) -eq $script:profileDir) {
        Remove-Item -LiteralPath $script:snapDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    if ($script:haveLock) { Exit-Lock $script:lockPath; $script:haveLock = $false }
    $v = Complete-Result $script:r $Verdict $Reason $script:resultPath
    Write-Output ('verdict=' + $v + ' reason=' + $script:r.reason + ' result=' + $script:resultPath)
    if ($v -eq 'pass') { exit 0 } else { exit 1 }
}

try {
    if ($Serial -notin $AllowedSerials) { Finish 'fail' ('serial ' + $Serial + ' is not in the allowed list') }
    if ($Package -notin $script:AllowedPackages) { Finish 'fail' ('package ' + $Package + ' is not in the allowed list') }
    if (-not (Test-SnapshotName $Id)) { Finish 'fail' ('bad snapshot id: ' + $Id) }
    if (-not (Test-SnapshotName $Profile)) { Finish 'fail' ('bad profile name: ' + $Profile) }
    $profileDir = Join-Path $SnapshotRoot $Profile
    $snapDir = Join-Path $profileDir $Id
    New-Item -ItemType Directory -Force -Path $profileDir | Out-Null
    if (-not (Enter-Lock $lockPath)) { Finish 'fail' ('another snapshot or restore holds ' + $lockPath) }
    $haveLock = $true
    if (Test-Path -LiteralPath $snapDir) { Finish 'fail' ('snapshot ' + $Id + ' already exists; ids are never overwritten') }

    Start-Phase 'prepare'
    if (-not (Initialize-Adb -Dir (Join-Path $OutDir 'adb') -AdbExe $AdbExe)) { Finish 'fail' 'adb start-server failed' }
    if ((Get-DeviceState $Serial) -ne 'device') { Finish 'fail' 'device-offline' }
    $r.device = Get-DeviceInfo $Serial
    $ident = Get-InstalledBuildInfo $Serial $Package
    if (-not $ident) { Finish 'fail' ('package ' + $Package + ' is not installed') }
    $r.build.kind = $ident.Kind
    $r.build.versionName = $ident.VersionName
    if ($ident.Kind -ne 'debug') { Finish 'fail' 'release-build: snapshots need a debuggable build because run-as is refused for a release build' }
    $null = Invoke-Adb -AdbArgs @('shell', 'am', 'force-stop', $Package) -Serial $Serial -TimeoutSec 20
    Start-Sleep -Milliseconds 800
    $alive = Get-PackagePid -Serial $Serial -Package $Package
    if ($alive.Status -ne 'absent') { Finish 'fail' ('app is not stopped after force-stop (' + $alive.Status + '); a running app would give an inconsistent snapshot') }
    $names = Get-AppDataNames $Serial $Package
    if ($null -eq $names -or $names.Count -eq 0) { Finish 'fail' 'app data listing unreadable or empty' }
    $stats = Get-AppDataStats $Serial $Package $names
    if (-not $stats) { Finish 'fail' 'app data sizes unreadable' }
    $estimate = [int64]$stats.TotalKb * 1024
    $r.data.bytes = $estimate
    $r.data.ceilingBytes = $RefuseBytes
    if ($estimate -gt $RefuseBytes) { Finish 'fail' ('refused: app data is about ' + $estimate + ' bytes, above the ' + $RefuseBytes + ' byte ceiling') }
    if ($estimate -gt $WarnBytes) {
        $w = 'warning: app data is about ' + [math]::Round($estimate / 1GB, 2) + ' GiB, above the ' + [math]::Round($WarnBytes / 1GB, 2) + ' GiB warning threshold'
        $r.warnings += $w
        Write-Output $w
    }
    $drive = New-Object System.IO.DriveInfo ([IO.Path]::GetPathRoot((Resolve-Path -LiteralPath $profileDir).Path))
    if ($drive.AvailableFreeSpace -lt ([int64]($estimate * 1.1) + 67108864)) { Finish 'fail' ('not enough free space on ' + $drive.Name + ' for the snapshot') }
    End-Phase ('entries=' + ($names -join ',') + ' estimateBytes=' + $estimate)

    Start-Phase 'archive'
    $partial = Join-Path $snapDir 'snapshot.tar.partial'
    New-Item -ItemType Directory -Force -Path $snapDir | Out-Null
    $snapCreated = $true
    $argv = @('-s', $Serial, 'exec-out', 'run-as', $Package, 'tar', '-cf', '-') + $names
    $limit = $RefuseBytes + 16777216
    $tick = {
        $len = 0
        if (Test-Path -LiteralPath $partial) { $len = (Get-Item -LiteralPath $partial).Length }
        if ($len -gt $limit) { return @{ verdict = 'fail'; reason = ('refused: the archive grew past ' + $limit + ' bytes') } }
        return $null
    }
    $left = Get-Remaining
    if ($left -le 0) { Finish 'timeout' 'cap reached before the archive started' }
    $run = Invoke-TrackedProcess -FilePath $script:AdbPath -ArgumentList $argv -StdoutPath $partial -StderrPath (Join-Path $OutDir 'tar.err') `
        -StdinPath (Join-Path $OutDir 'tar.in') -MaxSeconds $left -PollMs 1000 -OnTick $tick
    if ($run.TimedOut -or $run.Aborted) { $null = Stop-Tracked $run.Tracker }
    $archiveSec = ($run.EndedAt - $run.StartedAt).TotalSeconds
    $tarBytes = (Get-Item -LiteralPath $partial).Length
    End-Phase ('bytes=' + $tarBytes)
    if ($run.TimedOut) { Finish 'timeout' 'the archive exceeded the cap' }
    if ($run.Aborted) { Finish 'fail' $run.Aborted.reason }
    if ($run.ExitCode -ne 0) { Finish 'fail' ('adb exec-out tar exit ' + $run.ExitCode + ': ' + ([IO.File]::ReadAllText((Join-Path $OutDir 'tar.err'))).Trim()) }
    if ($tarBytes -le 0 -or ($tarBytes % 512) -ne 0) { Finish 'fail' ('archive is not a whole number of tar blocks (' + $tarBytes + ' bytes); the stream was damaged') }
    $r.transfer = [ordered]@{ direction = 'device-to-pc'; bytes = $tarBytes; seconds = [math]::Round($archiveSec, 2); mbPerSec = [math]::Round($tarBytes / 1MB / [math]::Max($archiveSec, 0.001), 2) }

    Start-Phase 'verify'
    $sha = (Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash
    $list = Invoke-Bounded -FilePath (Get-TarPath) -ArgumentList @('-tf', $partial) -TimeoutSec ([math]::Max(30, [math]::Min(600, (Get-Remaining))))
    if ($list.TimedOut -or $list.ExitCode -ne 0 -or $list.Err) { Finish 'fail' ('archive is not readable by tar: ' + $list.Err) }
    $entryFiles = @(($list.Out -split '\r?\n') | Where-Object { $_ -ne '' -and -not $_.EndsWith('/') }).Count
    if ($entryFiles -ne $stats.Files) { Finish 'fail' ('archive holds ' + $entryFiles + ' files, the device listed ' + $stats.Files) }
    $stats2 = Get-AppDataStats $Serial $Package $names
    if (-not $stats2) { Finish 'fail' 'app data sizes unreadable after the archive' }
    $diff = Compare-AppDataStats $stats $stats2
    if ($diff.Count -gt 0) { Finish 'fail' ('app data changed while it was archived: ' + ($diff -join '; ')) }
    $apkSha = $null
    $pm = Invoke-AdbShell $Serial ('pm path ' + $Package) 20
    if (-not $pm.TimedOut -and $pm.ExitCode -eq 0 -and $pm.Out -match '^package:(\S+)') {
        $ap = Invoke-AdbShell $Serial ('sha256sum ' + $Matches[1]) 120
        if (-not $ap.TimedOut -and $ap.ExitCode -eq 0 -and $ap.Out -match '^([0-9a-fA-F]{64})') { $apkSha = $Matches[1].ToUpperInvariant() }
    }
    $r.build.apkSha256 = $apkSha
    End-Phase ('files=' + $entryFiles)

    Start-Phase 'commit'
    Move-Item -LiteralPath $partial -Destination (Join-Path $snapDir 'snapshot.tar')
    $manifest = [ordered]@{
        schema = 1; id = $Id; profile = $Profile; package = $Package; serial = $Serial; createdAt = (Get-IsoNow); producedBy = $ProducedBy
        pinned = [bool]$Pin
        build = [ordered]@{ kind = $ident.Kind; versionName = $ident.VersionName; versionCode = $ident.VersionCode; signing = $ident.Signing; apkSha256 = $apkSha }
        tarBytes = $tarBytes; sha256 = $sha; fileCount = $stats.Files; totalKb = $stats.TotalKb; totalBytes = $stats.TotalBytes
        entries = @($stats.Names); entryKb = $stats.Kb; entryBytes = $stats.Bytes; excluded = @($script:SnapshotExcluded)
        warnings = @($r.warnings)
    }
    Write-JsonAtomic (Join-Path $snapDir 'snapshot.json') $manifest
    $r.snapshot = [ordered]@{ id = $Id; sha256 = $sha }
    End-Phase $null

    # Pruning only touches sibling directories of this profile that hold a manifest; pinned ones are never removed.
    $others = @()
    foreach ($d in @(Get-ChildItem -LiteralPath $profileDir -Directory)) {
        $mp = Join-Path $d.FullName 'snapshot.json'
        if (-not (Test-Path -LiteralPath $mp)) { continue }
        try { $m = Get-Content -LiteralPath $mp -Raw | ConvertFrom-Json -AsHashtable } catch { continue }
        if ($m.pinned) { continue }
        $others += [pscustomobject]@{ Dir = $d.FullName; Created = [string]$m.createdAt }
    }
    $pruned = @()
    foreach ($o in @($others | Sort-Object Created -Descending | Select-Object -Skip $Keep)) {
        if ((Split-Path -Parent $o.Dir) -ne $profileDir) { continue }
        Remove-Item -LiteralPath $o.Dir -Recurse -Force
        $pruned += (Split-Path -Leaf $o.Dir)
    }
    $r.pruned = $pruned
    $r.snapshotDir = $snapDir
    Finish 'pass' ('snapshot ' + $Id + ' taken: ' + $tarBytes + ' bytes, ' + $stats.Files + ' files')
} catch {
    Finish 'fail' ('exception: ' + $_.Exception.Message)
}
