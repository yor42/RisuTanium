# Runs one child command under a hard cap and writes <OutDir>\result.json.
# Completion is the child's exit (plus the optional artifact), never a marker line. First condition wins:
# done, cap (verdict timeout), crash or device-offline (only with -RequireApp), failure (nonzero exit).
# Pass leaves recorded survivors running (for example a Gradle daemon) and lists them in result.json;
# fail, timeout and crash stop every recorded descendant by PID. Exit code 0 only for verdict pass.
param(
    [Parameter(Mandatory)][string]$CheckId,
    [Parameter(Mandatory)][string]$OutDir,
    [Parameter(Mandatory)][ValidateRange(1, 1800)][int]$MaxSeconds,
    [Parameter(Mandatory)][string]$FilePath,
    [string[]]$ArgumentList = @(),
    [string]$WorkingDirectory,
    [Parameter(Mandatory)][ValidateSet('debug', 'release', 'none')][string]$BuildKind,
    [hashtable]$Environment = @{},
    [string]$ArtifactPath,
    [string]$Serial,
    [string]$Package,
    [switch]$RequireApp,
    [int]$PollSeconds = 2,
    [string]$RepoRoot,
    [string]$AdbExe,
    [switch]$KillLingering
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib.ps1')
Disable-StdHandleInherit
if (-not $RepoRoot) { $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$resultPath = Join-Path $OutDir 'result.json'
$logOut = Join-Path $OutDir 'child.out.log'
$logErr = Join-Path $OutDir 'child.err.log'

$r = New-Result -CheckId $CheckId -BuildKind $BuildKind -CapSec $MaxSeconds -Repo $RepoRoot -Serial $Serial
$r.evidence.log = $logOut
$r.evidence.stderr = $logErr
Save-Result $r $resultPath

$savedEnv = @{}
$tracker = $null
$verdict = 'running'
try {
    if ($Serial) {
        if (-not (Initialize-Adb -Dir (Join-Path $OutDir 'adb') -AdbExe $AdbExe)) { throw 'adb start-server failed' }
        $r.device = Get-DeviceInfo $Serial
    }
    foreach ($k in $Environment.Keys) {
        $savedEnv[$k] = [Environment]::GetEnvironmentVariable($k)
        [Environment]::SetEnvironmentVariable($k, [string]$Environment[$k])
    }
    $absent = 0
    $tick = {
        if (-not $RequireApp) { return $null }
        $s = Get-PackagePid -Serial $Serial -Package $Package
        if ($s.Status -eq 'offline') { $script:absent = 0; return @{ verdict = 'fail'; reason = 'device-offline' } }
        if ($s.Status -eq 'absent') {
            $script:absent++
            if ($script:absent -ge 2) { return @{ verdict = 'crash'; reason = 'app process gone for 2 consecutive polls' } }
        } else { $script:absent = 0 }
        return $null
    }
    $run = Invoke-TrackedProcess -FilePath $FilePath -ArgumentList $ArgumentList -WorkingDirectory $WorkingDirectory `
        -StdoutPath $logOut -StderrPath $logErr -StdinPath (Join-Path $OutDir 'child.in') `
        -MaxSeconds $MaxSeconds -PollMs ($PollSeconds * 1000) -OnTick $tick
    $tracker = $run.Tracker
    $r.rootPid = $run.RootPid
    $r.realPid = $run.RealPid
    $r.exitCode = $run.ExitCode
    $r.descendantPids = @($tracker.Known.Keys | Where-Object { $_ -ne $run.RootPid } | Sort-Object)

    if ($run.TimedOut) {
        $verdict = 'timeout'; $reason = ('cap of ' + $MaxSeconds + ' s reached')
    } elseif ($run.Aborted) {
        $verdict = $run.Aborted.verdict; $reason = $run.Aborted.reason
    } elseif ($run.ExitCode -ne 0) {
        $verdict = 'fail'; $reason = ('child exit code ' + $run.ExitCode)
    } else {
        $verdict = 'pass'; $reason = 'child exited 0'
        if ($ArtifactPath) {
            $item = Get-Item -LiteralPath $ArtifactPath -ErrorAction SilentlyContinue
            if (-not $item) {
                $verdict = 'fail'; $reason = 'artifact missing after a successful exit'
            } else {
                $r.build.apkSha256 = (Get-FileHash -LiteralPath $ArtifactPath -Algorithm SHA256).Hash
                $r.build.artifactPath = $ArtifactPath
                $r.build.artifactMtime = ConvertTo-IsoTime $item.LastWriteTime
                $r.build.artifactFresh = ($item.LastWriteTime -ge $run.StartedAt.AddSeconds(-2))
                $r.build.returnLagSec = [math]::Round(($run.EndedAt - $item.LastWriteTime).TotalSeconds, 2)
                if (-not $r.build.artifactFresh) { $reason = 'child exited 0; artifact not rewritten' }
            }
        }
    }
    $r.phases = @([ordered]@{ name = 'child'; startedAt = (ConvertTo-IsoTime $run.StartedAt); endedAt = (ConvertTo-IsoTime $run.EndedAt)
        durationSec = [math]::Round(($run.EndedAt - $run.StartedAt).TotalSeconds, 2); note = $null })

    if ($verdict -ne 'pass' -or $KillLingering) {
        $r.stoppedPids = @(Stop-Tracked $tracker)
    }
    $r.lingering = @(Get-AliveTracked $tracker)
} catch {
    $verdict = 'fail'
    $reason = 'runner exception: ' + $_.Exception.Message
    if ($tracker) { $r.stoppedPids = @(Stop-Tracked $tracker) }
} finally {
    foreach ($k in $savedEnv.Keys) { [Environment]::SetEnvironmentVariable($k, $savedEnv[$k]) }
}
$final = Complete-Result $r $verdict $reason $resultPath
Write-Output ('verdict=' + $final + ' reason=' + $r.reason + ' result=' + $resultPath)
if ($final -eq 'pass') { exit 0 } else { exit 1 }
