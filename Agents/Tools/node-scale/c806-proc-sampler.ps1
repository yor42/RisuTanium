# CHORE-806 stage 4: samples the private bytes and working set of a list of PIDs on a fixed interval.
#
#   powershell -NoProfile -File c806-proc-sampler.ps1 -PidFile <file> -OutFile <jsonl> -StopFile <file> [-IntervalMs 250]
#                                                     [-ParentPid <pid>] [-MaxSeconds <n>]
#
# Invariants:
# - Read-only: it only reads process counters. It starts, stops and kills nothing.
# - The PID list is re-read from PidFile (comma separated integers) on every tick, so the caller can follow a renderer that is
#   replaced. A PID that no longer exists is skipped for that tick.
# - One JSON line per tick: t is the epoch time in milliseconds taken before the counters are read; p holds one entry per PID
#   that was alive: id, priv (PrivateMemorySize64, the private bytes) and ws (WorkingSet64).
# - It ends when StopFile exists, when ParentPid (the caller, when given) is no longer running, or after MaxSeconds (when given), so
#   an orphaned sampler does not outlive its run. A tick that overruns the interval is not caught up, so the gaps in t are real.
param(
    [Parameter(Mandatory = $true)][string]$PidFile,
    [Parameter(Mandatory = $true)][string]$OutFile,
    [Parameter(Mandatory = $true)][string]$StopFile,
    [int]$IntervalMs = 250,
    [int]$ParentPid = 0,
    [int]$MaxSeconds = 0
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-ProcessSampleLineForC806 {
    param([long]$EpochMs, [int[]]$ProcessIds)
    $entries = New-Object System.Collections.Generic.List[string]
    foreach ($processId in $ProcessIds) {
        $proc = $null
        try {
            $proc = [System.Diagnostics.Process]::GetProcessById($processId)
            $entries.Add(('{{"id":{0},"priv":{1},"ws":{2}}}' -f $processId, $proc.PrivateMemorySize64, $proc.WorkingSet64))
        } catch {
            # the process is gone; it is simply absent from this tick
        } finally {
            if ($null -ne $proc) { $proc.Dispose() }
        }
    }
    return ('{{"t":{0},"p":[{1}]}}' -f $EpochMs, ($entries -join ','))
}

function Test-ParentProcessAliveForC806 {
    param([int]$ParentProcessId)
    if ($ParentProcessId -le 0) { return $true }
    $parent = $null
    try {
        $parent = [System.Diagnostics.Process]::GetProcessById($ParentProcessId)
        return (-not $parent.HasExited)
    } catch {
        return $false
    } finally {
        if ($null -ne $parent) { $parent.Dispose() }
    }
}

function Read-ProcessIdListForC806 {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return @() }
    $text = ''
    try {
        $stream = New-Object System.IO.FileStream($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        try {
            $reader = New-Object System.IO.StreamReader($stream)
            $text = $reader.ReadToEnd().Trim()
        } finally {
            $stream.Dispose()
        }
    } catch { return @() }
    if ($text -eq '') { return @() }
    $ids = New-Object System.Collections.Generic.List[int]
    foreach ($piece in $text.Split(',')) {
        $value = 0
        if ([int]::TryParse($piece.Trim(), [ref]$value)) { $ids.Add($value) }
    }
    return $ids.ToArray()
}

$writer = New-Object System.IO.StreamWriter($OutFile, $true)
$writer.AutoFlush = $true
$clock = [System.Diagnostics.Stopwatch]::StartNew()
try {
    while (-not (Test-Path -LiteralPath $StopFile)) {
        if (-not (Test-ParentProcessAliveForC806 -ParentProcessId $ParentPid)) { break }
        if ($MaxSeconds -gt 0 -and $clock.ElapsedMilliseconds -ge ($MaxSeconds * 1000)) { break }
        $tickStart = $clock.ElapsedMilliseconds
        $epoch = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        $ids = Read-ProcessIdListForC806 -Path $PidFile
        $writer.WriteLine((Get-ProcessSampleLineForC806 -EpochMs $epoch -ProcessIds $ids))
        $wait = $IntervalMs - ($clock.ElapsedMilliseconds - $tickStart)
        if ($wait -gt 0) { Start-Sleep -Milliseconds $wait }
    }
} finally {
    $writer.Dispose()
}
