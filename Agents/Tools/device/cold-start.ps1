# Cold-start check: N times force-stop, am start -W (TotalTime), a ready signal, a settle, then a settled PSS.
# Writes <OutDir>\result.json with one phase per run. Every wait polls the crash watch (lib.ps1): the intended force-stop is
# declared as an expectRelaunch window, so only an unexpected loss, pid change, fatal log line or renderer loss is a crash.
# The ready signal is a CDP probe (-ReadyText found in the page text, or -ReadyExpression true, or a rendered body).
# Every CDP call is bounded; a target that keeps timing out fails the check as cdp-unresponsive instead of hanging it.
# The script only ever removes the adb forwards it made, from -PortMin..-PortMax.
param(
    [string]$CheckId = 'cold-start',
    [Parameter(Mandatory)][string]$OutDir,
    [ValidateRange(1, 1800)][int]$MaxSeconds = 900,
    [ValidateRange(1, 20)][int]$Runs = 3,
    [int]$SettleSec = 25,
    [int]$PauseSec = 4,
    [int]$ReadySec = 90,
    [int]$CdpTimeoutMs = 5000,
    [int]$CdpStallCalls = 3,
    [int]$RelaunchGapSec = 30,
    [string]$ReadyText,
    [string]$ReadyExpression,
    [string]$Activity = '.MainActivity',
    [string]$Serial,
    [string[]]$AllowedSerials,
    [string]$Package,
    [ValidateSet('auto', 'debug', 'release')][string]$BuildKind = 'auto',
    [int]$PortMin = 6330,
    [int]$PortMax = 6399,
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
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$resultPath = Join-Path $OutDir 'result.json'
$logPath = Join-Path $OutDir 'cold-start.log'
$logcatPath = Join-Path $OutDir 'logcat.txt'
$deadline = (Get-Date).AddSeconds($MaxSeconds)
$r = New-Result -CheckId $CheckId -BuildKind $(if ($BuildKind -eq 'auto') { 'none' } else { $BuildKind }) -CapSec $MaxSeconds -Repo $RepoRoot -Serial $Serial
$r.evidence.log = $logPath
$r.cold = [ordered]@{ runs = $Runs; settleSec = $SettleSec; pauseSec = $PauseSec; readySec = $ReadySec; readyText = $ReadyText; activity = $Activity; relaunches = @() }
Save-Result $r $resultPath
$watch = $null
$fwd = $null
$lastTick = Get-Date '2000-01-01'

function Write-Log([string]$Text) { Add-Content -LiteralPath $script:logPath -Value ((Get-IsoNow) + ' ' + $Text) }
function Finish([string]$Verdict, [string]$Reason) {
    if ($script:fwd) { try { Remove-CdpForward $script:fwd } catch { } }
    if ($script:watch -and $script:r.device.serial) {
        try {
            $lc = Invoke-AdbShell $script:Serial ('logcat -b crash,main -d -v threadtime -T ''' + $script:watch.StartClock + '''') 30
            if (-not $lc.TimedOut -and $lc.ExitCode -eq 0) { [IO.File]::WriteAllText($script:logcatPath, $lc.Out); $script:r.evidence.logcat = $script:logcatPath }
        } catch { }
        $script:r.cold.relaunches = @($script:watch.Relaunches)
    }
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
# Waits with the watch polled; returns early with a stop object only when the check must end.
function Wait-Watched([double]$Seconds) {
    $end = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $end) {
        Stop-If (Get-Stop)
        Start-Sleep -Milliseconds 200
    }
}
function Get-Median($Values) {
    $v = @($Values | Where-Object { $null -ne $_ } | Sort-Object)
    if ($v.Count -eq 0) { return $null }
    $m = [math]::Floor($v.Count / 2)
    if ($v.Count % 2 -eq 1) { return $v[$m] }
    return (($v[$m - 1] + $v[$m]) / 2)
}

try {
    if ($Serial -notin $AllowedSerials) { Finish 'fail' ('serial ' + $Serial + ' is not in the allowed list') }
    if ($Package -notin $script:AllowedPackages) { Finish 'fail' ('package ' + $Package + ' is not in the allowed list') }
    if (-not (Initialize-Adb -Dir (Join-Path $OutDir 'adb') -AdbExe $AdbExe)) { Finish 'fail' 'adb start-server failed' }
    if ((Get-DeviceState $Serial) -ne 'device') { Finish 'fail' 'device-offline' }
    $r.device = Get-DeviceInfo $Serial
    $wv = Get-WebViewInfo $Serial
    $webviewPkg = $null
    if ($wv) { $r.device.webview = $wv.Package + ' ' + $wv.Version; $webviewPkg = $wv.Package }
    $bi = Get-InstalledBuildInfo $Serial $Package
    if (-not $bi) { Finish 'fail' ('package ' + $Package + ' is not installed') }
    $r.build.kind = $(if ($BuildKind -eq 'auto') { $bi.Kind } else { $BuildKind })
    $r.build.versionName = $bi.VersionName

    $watch = New-AppWatch -Serial $Serial -Package $Package
    if (-not $watch) { Finish 'fail' 'device clock unreadable' }
    $fwd = New-CdpForward $Serial $Package $PortMin $PortMax
    Write-Log ('start serial=' + $Serial + ' package=' + $Package + ' kind=' + $r.build.kind)

    $readyExpr = $ReadyExpression
    if (-not $readyExpr) {
        if ($ReadyText) { $readyExpr = 'document.body ? document.body.innerText.includes(' + (ConvertTo-Json $ReadyText -Compress) + ') : false' }
        else { $readyExpr = 'document.readyState === ''complete'' && !!document.body && document.body.innerText.trim().length > 0' }
    }
    $probe = 'JSON.stringify({fcp:(performance.getEntriesByName(''first-contentful-paint'')[0]||{}).startTime,dcl:performance.timing.domContentLoadedEventEnd-performance.timing.navigationStart,load:performance.timing.loadEventEnd-performance.timing.navigationStart,now:performance.now(),imgs:document.querySelectorAll(''img'').length})'
    $cdpArgs = @{ TimeoutMs = $CdpTimeoutMs }
    if ($CdpScript) { $cdpArgs.CdpScript = $CdpScript }

    for ($i = 1; $i -le $Runs; $i++) {
        $runStart = Get-Date
        $m = [ordered]@{ run = $i; amTotalMs = $null; amWaitMs = $null; readyHostMs = $null; page = $null; settledPssKB = $null; settledPssScope = $null; procs = $null; pid = $null }
        Write-Log ('run ' + $i + ' force-stop')
        Open-RelaunchWindow $watch 'force-stop' $RelaunchGapSec
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
        Remove-CdpForward $fwd
        Wait-Watched $PauseSec

        $sw = [Diagnostics.Stopwatch]::StartNew()
        $st = Invoke-AdbShell $Serial ('am start -W -n ' + $Package + '/' + $Activity) 60
        Write-Log ('run ' + $i + ' am start exit=' + $st.ExitCode + ' ' + (($st.Out -split '\r?\n') | Select-Object -First 3 | Out-String).Trim())
        if ($st.TimedOut) { Finish 'timeout' 'am start -W did not return within 60 s' }
        if ($st.Out -match 'TotalTime:\s*(\d+)') { $m.amTotalMs = [int]$Matches[1] }
        if ($st.Out -match 'WaitTime:\s*(\d+)') { $m.amWaitMs = [int]$Matches[1] }
        $ps = Get-PackagePid -Serial $Serial -Package $Package
        if ($ps.Status -eq 'absent') { Finish 'fail' ('app-not-running after am start: ' + (($st.Out -split '\r?\n') | Where-Object { $_ -match 'Error|Exception' } | Select-Object -First 1)) }
        if ($ps.Status -ne 'running') { Finish 'fail' ('adb-unresponsive after am start (' + $ps.Status + ')') }
        $m.pid = $ps.Pid
        $hit = Close-RelaunchWindow $watch ([int]$ps.Pid)
        if ($hit) { Finish 'crash' ($hit.Kind + ': ' + $hit.Line) }

        $ready = $false
        $stall = 0
        $lastKind = 'none'
        while ($sw.Elapsed.TotalSeconds -lt $ReadySec) {
            Stop-If (Get-Stop)
            if (-not $fwd.Port -or $fwd.Pid -ne $watch.LastPid) {
                $u = Update-CdpForward $fwd
                if (-not $u.Ok) { $lastKind = 'forward: ' + $u.Reason; Start-Sleep -Milliseconds 300; continue }
            }
            $c = Invoke-Cdp -Port $fwd.Port -Expression $readyExpr @cdpArgs
            if ($c.Kind -ne $lastKind) { Write-Log ('run ' + $i + ' cdp ' + $c.Kind + ' exit=' + $c.ExitCode + ' ' + $c.Err) }
            $lastKind = $c.Kind
            if ($c.Kind -eq 'ok') {
                $stall = 0
                if ($c.Value -eq 'true') { $ready = $true; $m.readyHostMs = [math]::Round($sw.Elapsed.TotalMilliseconds); break }
            } elseif ($c.Kind -eq 'timeout') {
                $stall++
                if ($stall -ge $CdpStallCalls) { Finish 'fail' ('cdp-unresponsive: ' + $stall + ' consecutive calls timed out at ' + $CdpTimeoutMs + ' ms') }
            } else { $stall = 0 }
            Start-Sleep -Milliseconds 100
        }
        if (-not $ready) { Finish 'timeout' ('ready signal not seen within ' + $ReadySec + ' s (last cdp: ' + $lastKind + ')') }

        $pr = Invoke-Cdp -Port $fwd.Port -Expression $probe @cdpArgs
        if ($pr.Kind -eq 'ok') {
            try { $m.page = ($pr.Value | ConvertFrom-Json) | ConvertFrom-Json } catch { $m.page = $pr.Value }
        } else { Write-Log ('run ' + $i + ' page probe: ' + $pr.Kind) }

        Wait-Watched $SettleSec
        $psOut = Invoke-AdbShell $Serial 'ps -A -o PID,NAME' 20
        $procs = @()
        foreach ($l in ($psOut.Out -split '\r?\n')) {
            $mm = [regex]::Match($l.Trim(), '^(\d+)\s+(\S+)$')
            if ($mm.Success) { $procs += [pscustomobject]@{ id = [int]$mm.Groups[1].Value; name = $mm.Groups[2].Value } }
        }
        # Only this package's processes count: its own pids and the sandboxed renderers whose uid tag is the app's.
        # Without that attribution the figure falls back to every process of the package and of the WebView package.
        $ownPids = @($procs | Where-Object { ($_.name -eq $Package -or $_.name.StartsWith($Package + ':')) -and $_.id -in $watch.Pids } | ForEach-Object { $_.id })
        $acts = Invoke-AdbShell $Serial 'dumpsys activity processes' 30
        $owned = @{ Known = $false; Pids = @() }
        if (-not $acts.TimedOut -and $acts.ExitCode -eq 0) { $owned = Get-OwnedSandboxPids $acts.Out $ownPids }
        $m.settledPssScope = $(if ($owned.Known) { 'package-attributed' } else { 'inclusive-webview' })
        $rows = @()
        foreach ($pr2 in $procs) {
            $nm = $pr2.name
            $count = $false
            if ($owned.Known) { $count = ($pr2.id -in $ownPids) -or ($pr2.id -in $owned.Pids) }
            else { $count = ($nm -eq $Package -or $nm.StartsWith($Package + ':') -or ($webviewPkg -and $nm.StartsWith($webviewPkg))) }
            if ($count) {
                $mem = Invoke-AdbShell $Serial ('dumpsys meminfo ' + $pr2.id) 20
                $pss = $null
                $pm = [regex]::Match($mem.Out, 'TOTAL(?: PSS)?:?\s+(\d+)')
                if ($pm.Success) { $pss = [int]$pm.Groups[1].Value }
                $rows += [pscustomobject]@{ pid = [string]$pr2.id; name = $nm; pss = $pss }
            }
        }
        Stop-If (Get-Stop)
        $m.settledPssKB = ($rows | Measure-Object pss -Sum).Sum
        $m.procs = @($rows | ForEach-Object { $_.name + '=' + $_.pss })
        $runEnd = Get-Date
        $r.phases += [ordered]@{ name = ('run-' + $i); startedAt = (ConvertTo-IsoTime $runStart); endedAt = (ConvertTo-IsoTime $runEnd)
            durationSec = [math]::Round(($runEnd - $runStart).TotalSeconds, 2); note = $null; metrics = $m }
        Save-Result $r $resultPath
        Write-Log ('run ' + $i + ' total=' + $m.amTotalMs + ' ready=' + $m.readyHostMs + ' pss=' + $m.settledPssKB)
    }
    $r.cold.summary = [ordered]@{ amTotalMsMedian = (Get-Median ($r.phases | ForEach-Object { $_.metrics.amTotalMs }))
        readyHostMsMedian = (Get-Median ($r.phases | ForEach-Object { $_.metrics.readyHostMs }))
        settledPssKBMedian = (Get-Median ($r.phases | ForEach-Object { $_.metrics.settledPssKB }))
        settledPssScope = (@($r.phases | ForEach-Object { $_.metrics.settledPssScope } | Select-Object -Unique) -join ',') }
    Finish 'pass' ($Runs.ToString() + ' cold starts completed')
} catch {
    Finish 'fail' ('runner exception: ' + $_.Exception.Message)
}
