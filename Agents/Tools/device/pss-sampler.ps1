# Samples the PSS (KiB) of the app process and of its own WebView sandbox process over adb, one line per cycle.
#   pwsh -NoProfile -File pss-sampler.ps1 -Serial <adb serial> -LogPath <file outside the repo> -GuardLog <guard log file> [-Package <id>]
#        [-MaxSeconds <n>] [-AllowedSerials <a,b>] [-SleepMs 300] [-StopFile <path>]
# Log line: <unix ms><TAB><app KiB><TAB><sandbox KiB>; a cycle without a single owned sandbox pid is <ms><TAB>0<TAB>0<TAB>DROP-owner
# (DROP-app when the app has no pid). Pids and KiB only: no package or process name is ever printed.
#
# Invariants:
# - -Serial is mandatory: an empty, blank or malformed value, or one outside -AllowedSerials when that list is given, exits 2
#   before the first adb call. There is no default serial. -GuardLog is mandatory too (exit 2): every adb call runs through
#   device-guard/adbg.mjs with --kit (lib.ps1 Initialize-AdbGuard and Invoke-Adb), which sends only the two spare Note 9s' calls and
#   logs each to -GuardLog. This script never starts adb itself and has no adb or guard path parameter. lib.ps1 and the guard are
#   found beside this file.
# - A call the guard refuses, a failed guard start and an adb call that times out end the run with exit 4 and one named line on
#   stderr. They are never logged as DROP: a refusal must not read as "app not running". An empty answer of a call the guard let
#   through still reads as a drop.
# - Sandbox ownership is resolved again on every resolve (first cycle, every 10th cycle and the cycle after any 0 reading), never
#   cached and never "first pgrep match". The sandbox process is named after the WebView provider package, not the app, so the
#   owner is read from `dumpsys meminfo --package <Package>` (the plain `dumpsys meminfo <Package>` form prints no sandbox lines),
#   whose per-process headers `** MEMINFO in pid N [<process name>] **` name the sandbox pids. The owned set is the header pids whose
#   bracket name contains sandboxed_process<digits>. The candidates are the `pgrep -f sandboxed_process` pids that are also in
#   that set: exactly one is sampled, none or several drop the cycle. The listing is parsed in memory and never printed or logged.
# - Three consecutive dropped cycles stop the sampler with exit 3 and a one-line reason.
# - Clean stop: create the stop file (default <LogPath>.stop), or stop the PID written to <LogPath>.pid by exact PID. Never kill
#   by image name.
# Exit codes: 0 done (deadline, -MaxCycles or stop file), 2 refused arguments, 3 three consecutive dropped cycles, 4 the guard
# refused a call, did not start, or an adb call timed out.
# -MaxCycles exists for the acceptance test; 0 means no cycle limit.
param(
    [string]$Serial = '',
    [string]$Package = 'io.github.yor42.risutanium',
    [string]$LogPath = '',
    [string]$GuardLog = '',
    [int]$MaxSeconds = 7200,
    [string[]]$AllowedSerials = @(),
    [int]$SleepMs = 300,
    [string]$StopFile = '',
    [int]$MaxCycles = 0
)

function Stop-SamplerRefused([string]$Reason) {
    [Console]::Error.WriteLine('pss-sampler: ' + $Reason)
    exit 2
}

function Stop-SamplerGuard([string]$Reason) {
    [Console]::Error.WriteLine('pss-sampler: ' + $Reason)
    exit 4
}

if ([string]::IsNullOrWhiteSpace($Serial)) { Stop-SamplerRefused '-Serial is required' }
if ($Serial -notmatch '^[A-Za-z0-9._:-]+$') { Stop-SamplerRefused '-Serial has characters an adb serial does not have' }
if ($AllowedSerials.Count -gt 0 -and ($AllowedSerials -notcontains $Serial)) { Stop-SamplerRefused '-Serial is not in -AllowedSerials' }
if ([string]::IsNullOrWhiteSpace($LogPath)) { Stop-SamplerRefused '-LogPath is required' }
if ([string]::IsNullOrWhiteSpace($GuardLog)) { Stop-SamplerRefused '-GuardLog is required: the guard log file every adb call is recorded in' }
if ($Package -notmatch '^[A-Za-z0-9._]+$') { Stop-SamplerRefused '-Package is not a package id' }
if ([string]::IsNullOrWhiteSpace($StopFile)) { $StopFile = $LogPath + '.stop' }

. (Join-Path $PSScriptRoot 'lib.ps1')
Disable-StdHandleInherit
$GuardLog = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($GuardLog)
# One folder per sampler process for the start-server output files, so two samplers sharing a log folder never share a file.
$guardDir = Join-Path (Split-Path -Parent $GuardLog) ('adb-' + $PID)
$guardReady = $false
try { $guardReady = Initialize-AdbGuard -Dir $guardDir -Serial $Serial -Log $GuardLog } catch { Stop-SamplerGuard $_.Exception.Message }
if (-not $guardReady) { Stop-SamplerGuard (Get-AdbInitReason) }

function New-SamplerAbort([string]$Reason) {
    $abort = [System.InvalidOperationException]::new('pss-sampler: ' + $Reason)
    $abort.Data['samplerAbort'] = $true
    return $abort
}

function Invoke-SamplerAdb([string[]]$AdbArgs) {
    $res = Invoke-Adb -AdbArgs $AdbArgs -Serial $Serial -TimeoutSec 20
    if ($res.TimedOut) { throw (New-SamplerAbort 'adb call timed out') }
    if (Test-AdbGuardRefusal $res) {
        $shown = (@($AdbArgs | ForEach-Object { if ($_ -eq $Package) { '<package>' } else { $_ } }) -join ' ')
        throw (New-SamplerAbort ('guard refused ' + $shown + ' (exit ' + $res.ExitCode + '; see ' + $GuardLog + ')'))
    }
    if ([string]::IsNullOrEmpty($res.Out)) { return @() }
    return @($res.Out -split '\r?\n')
}

function Get-SamplerPssKiB([string]$ProcessId) {
    if (-not $ProcessId) { return 0 }
    foreach ($line in (Invoke-SamplerAdb @('shell', 'dumpsys', 'meminfo', '-s', $ProcessId))) {
        if ($line -match '^\s*TOTAL:\s+([\d,]+)') { return [int]($Matches[1] -replace ',', '') }
    }
    return 0
}

# Returns @{ App = <pid or ''>; Sandbox = <pid or ''> }; Sandbox is empty unless exactly one owned sandbox pid is running.
function Resolve-SamplerOwnership {
    $appPid = ((Invoke-SamplerAdb @('shell', 'pidof', $Package)) -join ' ').Trim().Split(' ')[0]
    if (-not $appPid) { return @{ App = ''; Sandbox = '' } }
    $owned = @()
    foreach ($line in (Invoke-SamplerAdb @('shell', 'dumpsys', 'meminfo', '--package', $Package))) {
        if ($line -match '^\*\* MEMINFO in pid (\d+) \[[^\]]*sandboxed_process\d+[^\]]*\]') { $owned += $Matches[1] }
    }
    $running = @(((Invoke-SamplerAdb @('shell', 'pgrep', '-f', 'sandboxed_process')) -join ' ').Trim() -split '\s+' | Where-Object { $_ -match '^\d+$' })
    $candidates = @($running | Where-Object { $owned -contains $_ } | Select-Object -Unique)
    if ($candidates.Count -eq 1) { return @{ App = $appPid; Sandbox = $candidates[0] } }
    return @{ App = $appPid; Sandbox = '' }
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent ([IO.Path]::GetFullPath($LogPath))) | Out-Null
$pidFile = $LogPath + '.pid'
Set-Content -LiteralPath $pidFile -Value $PID -Encoding ascii
$end = (Get-Date).AddSeconds($MaxSeconds)
$appPid = ''
$sandboxPid = ''
$needResolve = $true
$cycle = 0
$drops = 0
$exitCode = 0
try {
    while ((Get-Date) -lt $end -and -not (Test-Path -LiteralPath $StopFile) -and ($MaxCycles -le 0 -or $cycle -lt $MaxCycles)) {
        $stamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        if ($needResolve -or ($cycle % 10) -eq 0) {
            $owner = Resolve-SamplerOwnership
            $appPid = $owner.App
            $sandboxPid = $owner.Sandbox
            $needResolve = $false
        }
        if (-not $appPid -or -not $sandboxPid) {
            $reason = if (-not $appPid) { 'DROP-app' } else { 'DROP-owner' }
            Add-Content -LiteralPath $LogPath -Value ("$stamp`t0`t0`t$reason")
            $drops++
            $needResolve = $true
            if ($drops -ge 3) {
                [Console]::Error.WriteLine('pss-sampler: three consecutive cycles without exactly one owned sandbox pid; stopped')
                $exitCode = 3
                break
            }
        } else {
            $drops = 0
            $appKiB = Get-SamplerPssKiB $appPid
            $sandboxKiB = Get-SamplerPssKiB $sandboxPid
            if ($appKiB -eq 0 -or $sandboxKiB -eq 0) { $needResolve = $true }
            Add-Content -LiteralPath $LogPath -Value ("$stamp`t$appKiB`t$sandboxKiB")
        }
        $cycle++
        if ($SleepMs -gt 0) { Start-Sleep -Milliseconds $SleepMs }
    }
} catch {
    if (-not $_.Exception.Data['samplerAbort']) { throw }
    [Console]::Error.WriteLine($_.Exception.Message)
    $exitCode = 4
} finally {
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}
exit $exitCode
