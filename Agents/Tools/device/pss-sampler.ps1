# Samples the PSS (KiB) of the app process and of its own WebView sandbox process over adb, one line per cycle.
#   pwsh -NoProfile -File pss-sampler.ps1 -Serial <adb serial> -LogPath <file outside the repo> [-Package <id>] [-MaxSeconds <n>]
#        [-AllowedSerials <a,b>] [-AdbExe <path>] [-SleepMs 300] [-StopFile <path>]
# Log line: <unix ms><TAB><app KiB><TAB><sandbox KiB>; a cycle without a single owned sandbox pid is <ms><TAB>0<TAB>0<TAB>DROP-owner
# (DROP-app when the app has no pid). Pids and KiB only: no package or process name is ever printed.
#
# Invariants:
# - -Serial is mandatory: an empty, blank or malformed value, or one outside -AllowedSerials when that list is given, exits 2
#   before the first adb call. There is no default serial and every adb call is `adb -s <serial> ...`.
# - Sandbox ownership is resolved again on every resolve (first cycle, every 10th cycle and the cycle after any 0 reading), never
#   cached and never "first pgrep match". The sandbox process is named after the WebView provider package, not the app, so the
#   owner is read from the app's own `dumpsys meminfo <Package>` listing, which prints the sandbox pids. The candidates are the
#   `pgrep -f sandboxed_process` pids that are also in that listing: exactly one is sampled, none or several drop the cycle.
#   The listing is filtered to pids at the source and is never printed or logged.
# - Three consecutive dropped cycles stop the sampler with exit 3 and a one-line reason.
# - Clean stop: create the stop file (default <LogPath>.stop), or stop the PID written to <LogPath>.pid by exact PID. Never kill
#   by image name.
# Exit codes: 0 done (deadline, -MaxCycles or stop file), 2 refused arguments, 3 three consecutive dropped cycles.
# -MaxCycles exists for the acceptance test; 0 means no cycle limit.
param(
    [string]$Serial = '',
    [string]$Package = 'io.github.yor42.risutanium',
    [string]$LogPath = '',
    [int]$MaxSeconds = 7200,
    [string[]]$AllowedSerials = @(),
    [string]$AdbExe = 'adb',
    [int]$SleepMs = 300,
    [string]$StopFile = '',
    [int]$MaxCycles = 0
)

function Stop-SamplerRefused([string]$Reason) {
    [Console]::Error.WriteLine('pss-sampler: ' + $Reason)
    exit 2
}

if ([string]::IsNullOrWhiteSpace($Serial)) { Stop-SamplerRefused '-Serial is required' }
if ($Serial -notmatch '^[A-Za-z0-9._:-]+$') { Stop-SamplerRefused '-Serial has characters an adb serial does not have' }
if ($AllowedSerials.Count -gt 0 -and ($AllowedSerials -notcontains $Serial)) { Stop-SamplerRefused '-Serial is not in -AllowedSerials' }
if ([string]::IsNullOrWhiteSpace($LogPath)) { Stop-SamplerRefused '-LogPath is required' }
if ($Package -notmatch '^[A-Za-z0-9._]+$') { Stop-SamplerRefused '-Package is not a package id' }
if ([string]::IsNullOrWhiteSpace($StopFile)) { $StopFile = $LogPath + '.stop' }

function Invoke-SamplerAdb([string[]]$AdbArgs) {
    return @(& $AdbExe -s $Serial @AdbArgs 2>$null)
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
    foreach ($line in (Invoke-SamplerAdb @('shell', 'dumpsys', 'meminfo', $Package))) {
        if ($line -match 'sandboxed_process\d+:.*\(pid (\d+)') { $owned += $Matches[1] }
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
} finally {
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}
exit $exitCode
