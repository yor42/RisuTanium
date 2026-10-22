# Import-bin check: starts from a restored snapshot, drives the app's own "load local backup" UI for one .bin fixture on a debuggable
# MEASURE build, collects the import phase ring and writes <OutDir>\result.json. The ring (__risuImportPhases) is on when the page's
# localStorage key risu-measure-import is on; that key is the established measurement toggle, not app data, and the script sets it
# after the app booted. Each ring mark becomes one phases[] row (name, ringMs on the page clock, heapMiB, wall-clock estimate);
# the raw longest snapshot is written to <OutDir>\phases.json in the same shape the earlier collector produced.
# Order, every step bounded by the cap: gates (serial, package, start state, data ceiling of a local fixture) with no adb call, the
# per-device lock (held for the whole run, released only while the restore child holds it), fixture push with a SHA-256 skip,
# restore of the snapshot, cold launch, read-only census, UI drive, import watch, settle, census again.
# The app reloads its page once the import committed, which ends the ring; the import counts as done at the terminal "import committed"
# mark or, when the page restarted after the mark "import commit start", at that restart. A restart alone is not a pass: it needs
# the store to have grown (end store2 entries above the start value), and so does a boot that is still loading at the end. A
# conflict or marker refusal of the first attempt is not the end while the app retries (-RetryGraceSec). The wizard observation
# waits for the loading screen to go (-BootWaitSec); import.bootState records booted, wizard, still-loading or unknown at the end.
# The census field chaIdTokens is not a character count and is no criterion. "Same starting state" rests on the snapshot hash and
# the restore verification recorded in snapshot and startState.
# Verdicts: pass (the import committed as above), crash (the app process is lost or a fatal log line appears, also during the
# settle and boot wait; nothing in this script stops the app, a harness does), timeout (cap), fail (everything else, with its reason).
# The data ceiling is declared by this check (-CeilingBytes); a fixture above it aborts before launch unless -AllowLarge and
# -AllowLargeReason are both given. With -FixturePath the gate runs before any adb call; a fixture already on the device is
# gated after the read-only calls that identify the device and the build, and before any write, restore or launch.
# The fixture name on the device carries the run id unless -RemoteName is given; a name the run made up is removed at the end.
# The tap coordinates are those of the test device (Note 9) and are parameters.
param(
    [string]$CheckId = 'import-bin',
    [Parameter(Mandatory)][string]$OutDir,
    [ValidateRange(1, 1800)][int]$MaxSeconds = 1500,
    [string]$FixturePath,
    [string]$RemoteName,
    [string]$RemoteDir = '/sdcard/Download',
    [int64]$CeilingBytes = 629145600,
    [switch]$AllowLarge,
    [string]$AllowLargeReason,
    [string]$SnapshotId,
    [string]$Profile = 'test',
    [string]$SnapshotRoot,
    [switch]$NoRestore,
    [string[]]$MenuTaps = @('62 157', '105 125', '105 283', '233 900', '538 610'),
    [string]$ConfirmTap = '264 1210',
    [string]$WarnPattern = 'This backup holds|\uC774 \uBC31\uC5C5 \uC548\uC758 \uB370\uC774\uD130\uBCA0\uC774\uC2A4\uB294',
    [string]$WizardPattern = 'Airisu',
    [int]$ReadySec = 90,
    [int]$LaunchSettleSec = 12,
    [int]$SettleSec = 8,
    [int]$BootWaitSec = 0,
    [string]$LoadingPattern = '^\s*Loading\.\.\.',
    [int]$PickWaitSec = 9,
    [double]$TapPauseSec = 2,
    [double]$ConfirmPauseSec = 3,
    [int]$CdpTimeoutMs = 4000,
    [int]$RelaunchGapSec = 30,
    [int]$RetryGraceSec = 120,
    [string]$Activity = '.MainActivity',
    [string]$Serial,
    [string[]]$AllowedSerials,
    [string]$Package,
    [int]$PortMin = 9500,
    [int]$PortMax = 9599,
    [int]$PollSeconds = 2,
    [string]$CdpScript,
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
$runId = [guid]::NewGuid().ToString('N').Substring(0, 8)
$ownRemote = $false
if (-not $RemoteName -and $FixturePath) {
    $RemoteName = [IO.Path]::GetFileNameWithoutExtension($FixturePath) + '-' + $runId + [IO.Path]::GetExtension($FixturePath)
    $ownRemote = $true
}
$lockPath = Join-Path $SnapshotRoot ('device-' + $Serial + '.lock')
$haveLock = $false
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$resultPath = Join-Path $OutDir 'result.json'
$logPath = Join-Path $OutDir 'import-bin.log'
$logcatPath = Join-Path $OutDir 'logcat.txt'
$ringPath = Join-Path $OutDir 'phases.json'
$deadline = (Get-Date).AddSeconds($MaxSeconds)
$r = New-Result -CheckId $CheckId -BuildKind 'none' -CapSec $MaxSeconds -Repo $RepoRoot -Serial $Serial
$r.evidence.log = $logPath
$r.data.ceilingBytes = $CeilingBytes
$r.warnings = @()
$r.steps = @()
$r.fixture = $null
$r.measure = [ordered]@{ flag = 'risu-measure-import'; set = $false; ringSeen = $false }
$r.start = $null
$r.atDone = $null
$r.end = $null
$r.startState = [ordered]@{ basis = 'none (-NoRestore)'; snapshotId = $null; snapshotSha256 = $null }
$r.runId = $runId
$r.import = [ordered]@{ pickedAt = $null; doneAt = $null; seconds = $null; outcome = $null; restartBased = $null; warnConfirmed = $false; bootFinished = $null; bootWaitedSec = $null; bootState = $null; wizardShown = $null; wizardPattern = $WizardPattern }
Save-Result $r $resultPath
$watch = $null
$fwd = $null
$step = $null
$lastTick = Get-Date '2000-01-01'
$ring = New-RingCollector
$lastRingPoll = Get-Date '2000-01-01'
$warnClicked = $false
$pushStarted = $false
$remotePath = $null
$warnClicks = 0
$lastWarnClick = Get-Date '2000-01-01'

function Write-Log([string]$Text) { Add-Content -LiteralPath $script:logPath -Value ((Get-IsoNow) + ' ' + $Text) }
function Start-Step([string]$Name) { $script:step = @{ name = $Name; t = Get-Date } }
function End-Step([string]$Note) {
    $e = Get-Date
    $script:r.steps += [ordered]@{ name = $script:step.name; startedAt = (ConvertTo-IsoTime $script:step.t); endedAt = (ConvertTo-IsoTime $e)
        durationSec = [math]::Round(($e - $script:step.t).TotalSeconds, 2); note = $Note }
}
function Get-Remaining { return [int][math]::Floor(($script:deadline - (Get-Date)).TotalSeconds) }
function Finish([string]$Verdict, [string]$Reason) {
    if ($script:fwd) { try { Remove-CdpForward $script:fwd } catch { } }
    if ($script:watch) {
        try {
            $lc = Invoke-AdbShell $script:Serial ('logcat -b crash,main -d -v threadtime -T ''' + $script:watch.StartClock + '''') 30
            if (-not $lc.TimedOut -and $lc.ExitCode -eq 0) { [IO.File]::WriteAllText($script:logcatPath, $lc.Out); $script:r.evidence.logcat = $script:logcatPath }
        } catch { }
    }
    try {
        $rows = @(Get-RingPhaseRows $script:ring)
        $script:r.phases = $rows
        if ($rows.Count -gt 0) {
            $raw = @($script:ring.Best | ForEach-Object { [ordered]@{ phase = [string]$_.phase; t = $_.t; heapMiB = $_.heapMiB } })
            [IO.File]::WriteAllText($script:ringPath, (ConvertTo-Json -InputObject $raw -Depth 4 -Compress), (New-Object System.Text.UTF8Encoding($false)))
            $script:r.evidence.phasesJson = $script:ringPath
            $script:r.measure.ringSeen = $true
        }
    } catch { Write-Log ('ring rows failed: ' + $_.Exception.Message) }
    # A fixture name this run made up belongs to this run alone; it is removed so per-run copies do not pile up on the device.
    if ($script:ownRemote -and $script:pushStarted) {
        try { $null = Invoke-AdbShell $script:Serial ('rm -f ' + $script:remotePath) 60 } catch { }
    }
    if ($script:haveLock) { Exit-Lock $script:lockPath; $script:haveLock = $false }
    Write-Log ('finish ' + $Verdict + ' ' + $Reason)
    $v = Complete-Result $script:r $Verdict $Reason $script:resultPath
    Write-Output ('verdict=' + $v + ' reason=' + $script:r.reason + ' result=' + $script:resultPath)
    if ($v -eq 'pass') { exit 0 } else { exit 1 }
}
function Get-Stop {
    if ((Get-Date) -ge $script:deadline) { return @{ verdict = 'timeout'; reason = ('cap of ' + $script:MaxSeconds + ' s reached') } }
    if (((Get-Date) - $script:lastTick).TotalSeconds -lt $script:PollSeconds) { return $null }
    $script:lastTick = Get-Date
    return (Test-AppWatch $script:watch)
}
function Stop-If($Stop) { if ($Stop) { Finish $Stop.verdict $Stop.reason } }
function Wait-Watched([double]$Seconds) {
    $end = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $end) {
        Stop-If (Get-Stop)
        Start-Sleep -Milliseconds 200
    }
}
function Get-CdpFresh([string]$Expression) {
    if (-not $script:fwd.Port -or $script:fwd.Pid -ne $script:watch.LastPid) {
        $u = Update-CdpForward $script:fwd
        if (-not $u.Ok) { return [pscustomobject]@{ Kind = 'error'; Value = ''; Err = ('forward: ' + $u.Reason); ExitCode = $null } }
    }
    $cdpArgs = @{ TimeoutMs = $script:CdpTimeoutMs }
    if ($script:CdpScript) { $cdpArgs.CdpScript = $script:CdpScript }
    return (Invoke-Cdp -Port $script:fwd.Port -Expression $Expression @cdpArgs)
}
function Update-Ring {
    $recv = Get-Date
    $c = Get-CdpFresh (Get-RingPollExpression $script:WarnPattern)
    $script:lastRingPoll = Get-Date
    if ($c.Kind -eq 'ok') { Update-RingCollector $script:ring $c.Value $recv }
    return $c
}

try {
    # ---- gates that need no adb call ----
    if ($Serial -notin $AllowedSerials) { Finish 'fail' ('serial ' + $Serial + ' is not in the allowed list') }
    if ($Package -notin $script:AllowedPackages) { Finish 'fail' ('package ' + $Package + ' is not in the allowed list') }
    if (-not $SnapshotId -and -not $NoRestore) { Finish 'fail' 'start-state: give -SnapshotId (the import starts from a restored snapshot) or -NoRestore' }
    if ($SnapshotId -and $NoRestore) { Finish 'fail' 'start-state: -SnapshotId and -NoRestore exclude each other' }
    if ($SnapshotId -and -not (Test-SnapshotName $SnapshotId)) { Finish 'fail' ('bad snapshot id: ' + $SnapshotId) }
    if (-not $RemoteName -or -not (Test-RemoteFixtureName $RemoteName)) { Finish 'fail' ('bad fixture name: ' + $RemoteName) }
    if (-not (Test-RemoteFixtureDir $RemoteDir)) { Finish 'fail' ('bad fixture directory: ' + $RemoteDir) }
    $remotePath = $RemoteDir + '/' + $RemoteName
    $r.data.fixture = $RemoteName
    if ($FixturePath) {
        if (-not (Test-Path -LiteralPath $FixturePath -PathType Leaf)) { Finish 'fail' ('fixture not found: ' + $FixturePath) }
        $r.data.bytes = (Get-Item -LiteralPath $FixturePath).Length
        $gate = Get-FixtureGate $r.data.bytes $CeilingBytes -AllowLarge:$AllowLarge -AllowLargeReason $AllowLargeReason
        if (-not $gate.Ok) { Finish 'fail' $gate.Reason }
        if ($gate.Warning) { $r.warnings += $gate.Warning; Write-Output $gate.Warning }
    }
    Save-Result $r $resultPath

    # ---- device lock: one run per device, for the whole run ----
    # A snapshot or restore of another process force-stops the app, so the import holds the device lock from here to Finish.
    New-Item -ItemType Directory -Force -Path $SnapshotRoot | Out-Null
    if (-not (Enter-Lock $lockPath)) { Finish 'fail' ('another snapshot, restore or import holds ' + $lockPath) }
    $haveLock = $true

    # ---- device ----
    if (-not (Initialize-Adb -Dir (Join-Path $OutDir 'adb') -AdbExe $AdbExe)) { Finish 'fail' 'adb start-server failed' }
    if ((Get-DeviceState $Serial) -ne 'device') { Finish 'fail' 'device-offline' }
    $r.device = Get-DeviceInfo $Serial
    $wv = Get-WebViewInfo $Serial
    if ($wv) { $r.device.webview = $wv.Package + ' ' + $wv.Version }
    $bi = Get-InstalledBuildInfo $Serial $Package
    if (-not $bi) { Finish 'fail' ('package ' + $Package + ' is not installed') }
    $r.build.kind = $bi.Kind
    $r.build.versionName = $bi.VersionName
    if ($bi.Kind -ne 'debug') { Finish 'fail' 'release-build: this check reads and restores app data with run-as, which needs a debuggable build' }
    Write-Log ('start serial=' + $Serial + ' package=' + $Package + ' kind=' + $r.build.kind + ' fixture=' + $RemoteName)

    if (-not $FixturePath) {
        $size = Get-RemoteFileSize $Serial $remotePath
        if ($null -eq $size) { Finish 'fail' ('fixture ' + $remotePath + ' is not on the device and no -FixturePath was given') }
        $r.data.bytes = $size
        $gate = Get-FixtureGate $size $CeilingBytes -AllowLarge:$AllowLarge -AllowLargeReason $AllowLargeReason
        if (-not $gate.Ok) { Finish 'fail' $gate.Reason }
        if ($gate.Warning) { $r.warnings += $gate.Warning; Write-Output $gate.Warning }
    }

    if ($FixturePath) {
        Start-Step 'fixture'
        $left = Get-Remaining
        if ($left -le 0) { Finish 'timeout' 'cap reached before the fixture push' }
        $pushStarted = $true
        $pf = Push-Fixture -Serial $Serial -LocalPath $FixturePath -RemotePath $remotePath -TimeoutSec ([math]::Min(1200, $left))
        $r.fixture = [ordered]@{ name = $RemoteName; remotePath = $remotePath; bytes = $pf.Bytes; sha256 = $pf.Sha256; pushSkipped = $pf.Skipped; pushSeconds = $pf.Seconds; mbPerSec = $pf.MbPerSec }
        End-Step $(if ($pf.Skipped) { 'push skipped, device hash matches' } else { 'pushed and verified' })
        if (-not $pf.Ok) { Finish $(if ($pf.Reason -match 'exceeded') { 'timeout' } else { 'fail' }) ('fixture: ' + $pf.Reason) }
    }

    if ($SnapshotId) {
        Start-Step 'restore'
        $left = Get-Remaining
        if ($left -le 0) { Finish 'timeout' 'cap reached before the restore' }
        $rdir = Join-Path $OutDir 'restore'
        $ra = @('-NoProfile', '-File', (Join-Path $PSScriptRoot 'restore-snapshot.ps1'), '-OutDir', $rdir, '-Id', $SnapshotId, '-Profile', $Profile,
            '-SnapshotRoot', $SnapshotRoot, '-Serial', $Serial, '-AllowedSerials', $Serial, '-Package', $Package,
            '-MaxSeconds', [string][math]::Min(900, $left), '-RepoRoot', $RepoRoot)
        if ($AdbExe) { $ra += @('-AdbExe', $AdbExe) }
        New-Item -ItemType Directory -Force -Path $rdir | Out-Null
        # The restore child takes the device lock itself, so this run lets go of it for the child's duration only and takes it
        # back at once; a process that slips in between makes the child's lock refusal or the take-back fail the run before launch.
        Exit-Lock $lockPath
        $haveLock = $false
        $run = Invoke-TrackedProcess -FilePath (Get-Process -Id $PID).Path -ArgumentList $ra -StdoutPath (Join-Path $rdir 'child.out') -StderrPath (Join-Path $rdir 'child.err') `
            -StdinPath (Join-Path $rdir 'child.in') -MaxSeconds ([math]::Min(960, $left))
        if ($run.TimedOut) { $null = Stop-Tracked $run.Tracker }
        if (Enter-Lock $lockPath) { $haveLock = $true } else { End-Step 'restore ended, the device lock was taken by another process'; Finish 'fail' ('another snapshot, restore or import took ' + $lockPath + ' while the restore ended') }
        if ($run.TimedOut) { End-Step 'restore exceeded the cap'; Finish 'timeout' 'the snapshot restore exceeded the cap' }
        $rres = $null
        $rp = Join-Path $rdir 'result.json'
        if (Test-Path -LiteralPath $rp) { $rres = Get-Content -LiteralPath $rp -Raw | ConvertFrom-Json -AsHashtable }
        if ($rres -and $rres.snapshot) {
            $r.snapshot = [ordered]@{ id = [string]$rres.snapshot.id; sha256 = [string]$rres.snapshot.sha256 }
            $r.startState = [ordered]@{ basis = 'restored snapshot, tar SHA-256 and per-entry sizes verified by restore-snapshot'; snapshotId = $r.snapshot.id; snapshotSha256 = $r.snapshot.sha256 }
        }
        End-Step $(if ($rres) { 'restore ' + $rres.verdict } else { 'restore left no result' })
        if (-not $rres -or $rres.verdict -ne 'pass') { Finish 'fail' ('restore-snapshot: ' + $(if ($rres) { $rres.reason } else { 'no result.json, exit ' + $run.ExitCode })) }
    }

    # ---- launch ----
    Start-Step 'launch'
    $watch = New-AppWatch -Serial $Serial -Package $Package
    if (-not $watch) { Finish 'fail' 'device clock unreadable' }
    $fwd = New-CdpForward $Serial $Package $PortMin $PortMax
    Open-RelaunchWindow $watch 'launch' $RelaunchGapSec
    $fs = Invoke-AdbShell $Serial ('am force-stop ' + $Package) 20
    if ($fs.TimedOut -or $fs.ExitCode -ne 0) { Finish 'fail' ('am force-stop failed: ' + $fs.Err) }
    $stopEnd = (Get-Date).AddSeconds(10)
    $gone = $false
    while ((Get-Date) -lt $stopEnd) {
        Stop-If (Get-Stop)
        $ps = Get-PackagePid -Serial $Serial -Package $Package
        if ($ps.Status -eq 'absent') { $gone = $true; break }
        Start-Sleep -Milliseconds 300
    }
    if (-not $gone) { Finish 'fail' 'force-stop-ineffective: the app process is still running 10 s after am force-stop' }
    $null = Invoke-AdbShell $Serial 'input keyevent KEYCODE_WAKEUP' 20
    $st = Invoke-AdbShell $Serial ('am start -W -n ' + $Package + '/' + $Activity) 60
    Write-Log ('am start exit=' + $st.ExitCode + ' ' + (($st.Out -split '\r?\n') | Select-Object -First 3 | Out-String).Trim())
    if ($st.TimedOut) { Finish 'timeout' 'am start -W did not return within 60 s' }
    $ps = Get-PackagePid -Serial $Serial -Package $Package
    if ($ps.Status -eq 'absent') { Finish 'fail' 'app-not-running after am start' }
    if ($ps.Status -ne 'running') { Finish 'fail' ('adb-unresponsive after am start (' + $ps.Status + ')') }
    $hit = Close-RelaunchWindow $watch ([int]$ps.Pid)
    if ($hit) { Finish 'crash' ($hit.Kind + ': ' + $hit.Line) }
    $readyExpr = 'document.readyState === ''complete'' && !!document.body && document.body.innerText.trim().length > 0'
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $ready = $false
    $lastKind = 'none'
    while ($sw.Elapsed.TotalSeconds -lt $ReadySec) {
        Stop-If (Get-Stop)
        $c = Get-CdpFresh $readyExpr
        $lastKind = $c.Kind
        if ($c.Kind -eq 'ok' -and $c.Value -eq 'true') { $ready = $true; break }
        Start-Sleep -Milliseconds 300
    }
    if (-not $ready) { Finish 'timeout' ('ready signal not seen within ' + $ReadySec + ' s (last cdp: ' + $lastKind + ')') }
    Wait-Watched $LaunchSettleSec
    $okClick = 'new Promise(r=>{const b=[...document.querySelectorAll("button")].find(b=>b.innerText.trim()==="OK");if(b){b.click();r("ok")}else r("none")})'
    for ($k = 0; $k -lt 3; $k++) {
        $c = Get-CdpFresh $okClick
        if ($c.Kind -eq 'ok' -and $c.Value -match 'ok') { Write-Log 'dismissed a notice'; Wait-Watched 4 } else { break }
    }
    $fl = Get-CdpFresh 'localStorage.setItem("risu-measure-import","on"); typeof globalThis.__risuImportPhases'
    if ($fl.Kind -ne 'ok') { Finish 'fail' ('could not set the measurement flag (cdp ' + $fl.Kind + ')') }
    $r.measure.set = $true
    $r.start = Get-AppDataCensus $Serial $Package
    End-Step ('app up, store2Entries=' + $r.start.store2Entries + ' chaIdTokens=' + $r.start.chaIdTokens)
    Write-Log ('start state chaIdTokens=' + $r.start.chaIdTokens + ' store2Entries=' + $r.start.store2Entries)
    Save-Result $r $resultPath

    # ---- drive the app's own load-local-backup UI ----
    Start-Step 'ui'
    foreach ($t in $MenuTaps) {
        if ($t -notmatch '^\d+ \d+$') { Finish 'fail' ('bad tap: ' + $t) }
        $null = Invoke-AdbShell $Serial ('input tap ' + $t) 20
        Wait-Watched $TapPauseSec
    }
    if ($ConfirmTap -notmatch '^\d+ \d+$') { Finish 'fail' ('bad tap: ' + $ConfirmTap) }
    foreach ($k in 1..2) {
        Wait-Watched $ConfirmPauseSec
        $null = Invoke-AdbShell $Serial ('input tap ' + $ConfirmTap) 20
    }
    Wait-Watched $PickWaitSec
    $uiRemote = '/sdcard/risu-import-ui.xml'
    $null = Invoke-AdbShell $Serial ('uiautomator dump ' + $uiRemote) 60
    $cat = Invoke-AdbShell $Serial ('cat ' + $uiRemote) 60
    $null = Invoke-AdbShell $Serial ('rm -f ' + $uiRemote) 30
    [IO.File]::WriteAllText((Join-Path $OutDir 'picker-ui.xml'), $cat.Out)
    $mm = [regex]::Match($cat.Out, 'text="' + [regex]::Escape($RemoteName) + '"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"')
    if (-not $mm.Success) { Finish 'fail' ('file-not-in-picker: ' + $RemoteName + ' was not found in the file picker') }
    $px = [int](([int]$mm.Groups[1].Value + [int]$mm.Groups[3].Value) / 2)
    $py = [int](([int]$mm.Groups[2].Value + [int]$mm.Groups[4].Value) / 2)
    $pickAt = Get-Date
    $null = Invoke-AdbShell $Serial ('input tap ' + $px + ' ' + $py) 20
    $r.import.pickedAt = ConvertTo-IsoTime $pickAt
    End-Step ('picked ' + $RemoteName + ' at ' + $px + ',' + $py)
    Write-Log ('picked ' + $RemoteName)
    Save-Result $r $resultPath

    # ---- import watch ----
    Start-Step 'import'
    $yesClick = Get-ConfirmClickExpression $WarnPattern
    $outcome = $null
    while ($true) {
        Stop-If (Get-Stop)
        if (((Get-Date) - $lastRingPoll).TotalSeconds -ge $PollSeconds) {
            $null = Update-Ring
            # A click can land before the dialog accepts it; the confirm is repeated while the warning text still shows.
            if ($ring.Warn -and $warnClicks -lt 6 -and ((Get-Date) - $lastWarnClick).TotalSeconds -ge 6) {
                $warnClicks++
                $lastWarnClick = Get-Date
                $y = Get-CdpFresh $yesClick
                Write-Log ('size warning shown; confirm ' + $y.Kind + ' ' + $y.Value)
                if ($y.Kind -eq 'ok' -and $y.Value -match 'clicked') { $r.import.warnConfirmed = $true; $r.import.warnClicks = $warnClicks }
            }
            $o = Get-ImportDone $ring $RetryGraceSec
            if ($o.Done) { $outcome = $o; break }
        }
        Start-Sleep -Milliseconds 200
    }
    $doneAt = Get-Date
    $r.import.doneAt = ConvertTo-IsoTime $doneAt
    $r.import.seconds = [math]::Round(($doneAt - $pickAt).TotalSeconds, 2)
    $r.import.outcome = $outcome.Reason
    $r.import.restartBased = [bool]$outcome.Restart
    End-Step $outcome.Reason
    Write-Log ('import outcome: ' + $outcome.Reason + ' after ' + $r.import.seconds + ' s')
    if (-not $outcome.Pass) { Finish 'fail' $outcome.Reason }

    # The census right at the end of the import; it is read again after the boot, because the app rewrites data while it boots.
    $r.atDone = Get-AppDataCensus $Serial $Package

    # ---- settle and observe ----
    Start-Step 'settle'
    Wait-Watched $SettleSec
    $null = Update-Ring
    # The imported data boots after the reload; the setup wizard can only show once the loading screen is gone, so the
    # observation waits for that (at most -BootWaitSec) and stays null when the boot did not finish.
    $bootStart = Get-Date
    $loadExpr = 'document.body ? !(new RegExp(' + (ConvertTo-Json $LoadingPattern -Compress) + ').test(document.body.innerText)) : false'
    $bootDone = $false
    $bootEnd = (Get-Date).AddSeconds($BootWaitSec)
    while ($true) {
        $lc = Get-CdpFresh $loadExpr
        if ($lc.Kind -eq 'ok' -and $lc.Value -eq 'true') { $bootDone = $true; break }
        if ((Get-Date) -ge $bootEnd) { break }
        Stop-If (Get-Stop)
        Start-Sleep -Milliseconds 500
    }
    $r.import.bootFinished = $bootDone
    $r.import.bootWaitedSec = [math]::Round(((Get-Date) - $bootStart).TotalSeconds, 2)
    if ($bootDone) {
        $wz = Get-CdpFresh ('document.body ? new RegExp(' + (ConvertTo-Json $WizardPattern -Compress) + ').test(document.body.innerText) : false')
        if ($wz.Kind -eq 'ok') { $r.import.wizardShown = ($wz.Value -eq 'true') }
    }
    $r.end = Get-AppDataCensus $Serial $Package
    $r.import.bootState = Get-BootState $bootDone $r.import.wizardShown
    End-Step ('store2Entries=' + $r.end.store2Entries + ' bootState=' + $r.import.bootState)
    Stop-If (Get-Stop)
    $vd = Get-ImportVerdict $outcome $r.start $r.end $r.import.bootState $r.import.seconds
    Finish $vd.Verdict $vd.Reason
} catch {
    Finish 'fail' ('runner exception: ' + $_.Exception.Message)
}
