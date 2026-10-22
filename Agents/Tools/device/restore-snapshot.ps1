# Restores a snapshot taken by snapshot.ps1 into the test device's app data (debug builds only) and writes <OutDir>\result.json.
# Everything that can fail without touching the device is checked first and aborts before any device write:
# the manifest, the tar size and its SHA-256 against the manifest, the installed build (debuggable, same versionCode and
# signing digest as the snapshot, same package) and the free space. Then the app is force-stopped, the tar is pushed to a
# unique temp file and its hash is checked on the device, the covered top-level entries of the app data dir are removed
# as a whole and replaced by the tar contents (extracted inside the app uid, so ownership and labels are the app's own).
# Finally the entry list, the file count and the exact byte sum per entry must equal the manifest (du block counts are
# recorded too but differ with filesystem allocation, so they are not compared). Nothing is edited inside a snapshot or
# merged into the existing data. cache, code_cache and lib are left alone. adb stdin is not binary-safe on Windows, so the
# tar travels by adb push.
param(
    [Parameter(Mandatory)][string]$OutDir,
    [Parameter(Mandatory)][string]$Id,
    [string]$Profile = 'test',
    [string]$SnapshotRoot,
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
$r = New-Result -CheckId 'restore-snapshot' -BuildKind 'none' -CapSec $MaxSeconds -Repo $RepoRoot -Serial $Serial
$r.transfer = $null
$r.deviceTouched = $false
$lockPath = Join-Path $SnapshotRoot ('device-' + $Serial + '.lock')
$haveLock = $false
$remoteTar = $null
$phase = $null

function Start-Phase([string]$Name) { $script:phase = @{ name = $Name; t = Get-Date } }
function End-Phase([string]$Note) {
    $e = Get-Date
    $script:r.phases += [ordered]@{ name = $script:phase.name; startedAt = (ConvertTo-IsoTime $script:phase.t); endedAt = (ConvertTo-IsoTime $e)
        durationSec = [math]::Round(($e - $script:phase.t).TotalSeconds, 2); note = $Note }
}
function Get-Remaining { return [int][math]::Floor(($script:deadline - (Get-Date)).TotalSeconds) }
function Finish([string]$Verdict, [string]$Reason) {
    if ($script:remoteTar) {
        $null = Invoke-Adb -AdbArgs @('shell', 'rm', '-f', $script:remoteTar) -Serial $script:Serial -TimeoutSec 30
        $script:remoteTar = $null
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

    # ---- checks that never touch the device ----
    Start-Phase 'integrity'
    $snapDir = Join-Path (Join-Path $SnapshotRoot $Profile) $Id
    $tarPath = Join-Path $snapDir 'snapshot.tar'
    $manPath = Join-Path $snapDir 'snapshot.json'
    if (-not (Test-Path -LiteralPath $manPath) -or -not (Test-Path -LiteralPath $tarPath)) { Finish 'fail' ('snapshot ' + $Id + ' not found or incomplete under ' + $snapDir) }
    $m = Get-Content -LiteralPath $manPath -Raw | ConvertFrom-Json -AsHashtable
    if ($m.schema -ne 1 -or -not $m.sha256 -or -not $m.build -or -not $m.entries -or -not $m.entryBytes) { Finish 'fail' 'manifest is not a schema 1 snapshot manifest' }
    foreach ($n in @($m.entries)) { if (-not (Test-AppDataEntryName ([string]$n)) -or $n -in $script:SnapshotExcluded) { Finish 'fail' ('manifest names an unsafe entry: ' + $n) } }
    $r.snapshot = [ordered]@{ id = $Id; sha256 = [string]$m.sha256 }
    if ($m.package -ne $Package) { Finish 'fail' ('snapshot belongs to package ' + $m.package + ', not ' + $Package) }
    $size = (Get-Item -LiteralPath $tarPath).Length
    if ($size -ne [int64]$m.tarBytes) { Finish 'fail' ('integrity: tar is ' + $size + ' bytes, the manifest says ' + $m.tarBytes + '; nothing was changed on the device') }
    $sha = (Get-FileHash -LiteralPath $tarPath -Algorithm SHA256).Hash
    if ($sha -ne [string]$m.sha256) { Finish 'fail' ('integrity: tar SHA-256 does not match the manifest; nothing was changed on the device') }
    $r.data.bytes = $size
    End-Phase ('bytes=' + $size)

    New-Item -ItemType Directory -Force -Path $SnapshotRoot | Out-Null
    if (-not (Enter-Lock $lockPath)) { Finish 'fail' ('another snapshot or restore holds ' + $lockPath) }
    $haveLock = $true

    Start-Phase 'device-checks'
    if (-not (Initialize-Adb -Dir (Join-Path $OutDir 'adb') -AdbExe $AdbExe)) { Finish 'fail' 'adb start-server failed' }
    if ((Get-DeviceState $Serial) -ne 'device') { Finish 'fail' 'device-offline' }
    $r.device = Get-DeviceInfo $Serial
    $ident = Get-InstalledBuildInfo $Serial $Package
    if (-not $ident) { Finish 'fail' ('package ' + $Package + ' is not installed') }
    $r.build.kind = $ident.Kind
    $r.build.versionName = $ident.VersionName
    if ($ident.Kind -ne 'debug') { Finish 'fail' 'release-build: restore needs a debuggable build because run-as is refused for a release build; nothing was changed on the device' }
    if ($null -eq $ident.VersionCode -or $ident.VersionCode -ne [int64]$m.build.versionCode) {
        Finish 'fail' ('build-mismatch: installed versionCode ' + $ident.VersionCode + ', snapshot ' + $m.build.versionCode + '; take a new snapshot for this build. Nothing was changed on the device')
    }
    if (-not $ident.Signing -or $ident.Signing -ne [string]$m.build.signing) {
        Finish 'fail' ('build-mismatch: installed signing digest ' + $ident.Signing + ', snapshot ' + $m.build.signing + '; take a new snapshot for this build. Nothing was changed on the device')
    }
    $curNames = Get-AppDataNames $Serial $Package
    if ($null -eq $curNames) { Finish 'fail' 'app data listing unreadable' }
    $cur = Get-AppDataStats $Serial $Package $curNames
    if (-not $cur) { Finish 'fail' 'app data sizes unreadable' }
    $freeKb = Get-DataFreeKB $Serial
    if ($null -eq $freeKb) { Finish 'fail' 'free space of the device /data is unreadable; nothing was changed' }
    if (([int64]$freeKb + [int64]$cur.TotalKb) * 1024 -lt [int64]($size * 2.1) + 67108864) { Finish 'fail' 'not enough free space on the device /data for the restore; nothing was changed' }
    End-Phase $null

    # ---- device changes start here ----
    Start-Phase 'stop-and-push'
    $left = Get-Remaining
    if ($left -le 0) { Finish 'timeout' 'cap reached before the push' }
    $null = Invoke-Adb -AdbArgs @('shell', 'am', 'force-stop', $Package) -Serial $Serial -TimeoutSec 20
    Start-Sleep -Milliseconds 800
    $alive = Get-PackagePid -Serial $Serial -Package $Package
    if ($alive.Status -ne 'absent') { Finish 'fail' ('app is not stopped after force-stop (' + $alive.Status + ')') }
    $remote = '/data/local/tmp/risu-restore-' + [guid]::NewGuid().ToString('N') + '.tar'
    $script:remoteTar = $remote
    $pushStart = Get-Date
    $push = Invoke-Adb -AdbArgs @('push', $tarPath, $remote) -Serial $Serial -TimeoutSec ([math]::Min(1200, $left))
    $pushSec = ((Get-Date) - $pushStart).TotalSeconds
    if ($push.TimedOut) { Finish 'timeout' 'adb push exceeded the cap' }
    if ($push.ExitCode -ne 0) { Finish 'fail' ('adb push failed: ' + $push.Out + ' ' + $push.Err) }
    $null = Invoke-Adb -AdbArgs @('shell', 'chmod', '644', $remote) -Serial $Serial -TimeoutSec 20
    $hs = Invoke-AdbShell $Serial ('sha256sum ' + $remote) ([math]::Max(30, [math]::Min(600, (Get-Remaining))))
    if ($hs.TimedOut -or $hs.ExitCode -ne 0 -or $hs.Out -notmatch '^([0-9a-fA-F]{64})') { Finish 'fail' ('could not hash the pushed tar on the device: ' + $hs.Err) }
    if ($Matches[1].ToUpperInvariant() -ne $sha) { Finish 'fail' 'integrity: the tar changed in transfer (device hash differs); the app data was not touched' }
    $r.transfer = [ordered]@{ direction = 'pc-to-device'; bytes = $size; seconds = [math]::Round($pushSec, 2); mbPerSec = [math]::Round($size / 1MB / [math]::Max($pushSec, 0.001), 2) }
    # The push can take a while; the app must still be down immediately before its data is removed.
    $null = Invoke-Adb -AdbArgs @('shell', 'am', 'force-stop', $Package) -Serial $Serial -TimeoutSec 20
    Start-Sleep -Milliseconds 800
    $alive2 = Get-PackagePid -Serial $Serial -Package $Package
    if ($alive2.Status -ne 'absent') { Finish 'fail' ('app was running again after the push (' + $alive2.Status + '); the app data was not touched') }
    End-Phase ('push mbPerSec=' + $r.transfer.mbPerSec)

    Start-Phase 'replace'
    $r.deviceTouched = $true
    if ($curNames.Count -gt 0) {
        $rm = Invoke-AdbShell $Serial ('run-as ' + $Package + ' rm -rf ' + ($curNames -join ' ')) 300
        if ($rm.TimedOut -or $rm.ExitCode -ne 0) { Finish 'fail' ('removing the current app data failed: ' + $rm.Err + '; the data is in an undefined state, restore again') }
    }
    $left = Get-Remaining
    if ($left -le 0) { Finish 'timeout' 'cap reached before extraction; the data is in an undefined state, restore again' }
    $ex = Invoke-AdbShell $Serial ('run-as ' + $Package + ' tar -xf ' + $remote) ([math]::Min(1200, $left))
    if ($ex.TimedOut) { Finish 'timeout' 'tar extraction exceeded the cap; the data is in an undefined state, restore again' }
    if ($ex.ExitCode -ne 0) { Finish 'fail' ('tar extraction failed: ' + $ex.Out + ' ' + $ex.Err + '; the data is in an undefined state, restore again') }
    End-Phase $null

    Start-Phase 'verify'
    $want =@{ Names = @($m.entries); Bytes = $m.entryBytes; Files = [int64]$m.fileCount }
    $gotNames = Get-AppDataNames $Serial $Package
    if ($null -eq $gotNames) { Finish 'fail' 'app data listing unreadable after the restore' }
    $got = Get-AppDataStats $Serial $Package $gotNames
    if (-not $got) { Finish 'fail' 'app data sizes unreadable after the restore' }
    $r.verified = [ordered]@{ entries = @($got.Names); totalKb = $got.TotalKb; totalBytes = $got.TotalBytes; files = $got.Files }
    $diff = Compare-AppDataStats $want $got
    if ($diff.Count -gt 0) { Finish 'fail' ('verify-mismatch: ' + ($diff -join '; ')) }
    End-Phase ('files=' + $got.Files + ' totalKb=' + $got.TotalKb)
    Finish 'pass' ('snapshot ' + $Id + ' restored and verified against the manifest')
} catch {
    Finish 'fail' ('exception: ' + $_.Exception.Message)
}
