# Shared helpers for the device-check scripts. Dot-source this file; do not run it.
#
# Invariants:
# - Child processes redirect stdout, stderr and stdin to files. A pipe or a marker line in the child is never used,
#   because a lingering daemon that inherits a pipe keeps the caller waiting after the artifact exists.
# - Start-Process is never used with -Wait and WaitForExit is always given a timeout.
# - Argument lists are joined into one explicitly quoted string, so paths with spaces survive.
# - Every adb call is bounded by a timeout and checked by exit code.
# - Descendants of a child are recorded on every tick, so an orphan whose parent already exited can still be stopped by PID.

$script:AdbPath = 'adb'
$script:AdbTmp = $null
$script:AdbSeq = 0
$script:DefaultSerial = '29f3cde9193f7ece'
$script:DefaultPackage = 'io.github.yor42.risutanium'
$script:AllowedPackages = @('io.github.yor42.risutanium')
$script:ScratchRoot = Join-Path $env:TEMP 'risu-b715'
$script:DeviceToolsDir = $PSScriptRoot
$script:NodePath = $null

# A child created by Start-Process inherits every inheritable handle of this process, including the pipe a caller reads
# our own output from; a lingering daemon would then keep that caller waiting. Clearing the inherit flag on the standard
# handles (this process keeps using them) removes that path. Call once at the start of every entry script.
function Disable-StdHandleInherit {
    if (-not ('RisuDevHandle' -as [type])) {
        Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class RisuDevHandle { [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int n); [DllImport("kernel32.dll")] static extern bool SetHandleInformation(IntPtr h, uint mask, uint flags); public static void Clear() { foreach (int n in new int[] { -10, -11, -12 }) { IntPtr h = GetStdHandle(n); if (h != IntPtr.Zero && h != new IntPtr(-1)) SetHandleInformation(h, 1, 0); } } }'
    }
    [RisuDevHandle]::Clear()
}

function Get-IsoNow {
    return (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss.fffzzz')
}

function ConvertTo-IsoTime([datetime]$Time) {
    return $Time.ToString('yyyy-MM-ddTHH:mm:ss.fffzzz')
}

function ConvertTo-QuotedArg([string]$Arg) {
    if ($Arg -eq '') { return '""' }
    if ($Arg -notmatch '[\s"]') { return $Arg }
    $e = $Arg -replace '(\\*)"', '$1$1\"'
    $e = $e -replace '(\\+)$', '$1$1'
    return '"' + $e + '"'
}

function Join-ProcessArgs([string[]]$ArgList) {
    if (-not $ArgList) { return '' }
    return (($ArgList | ForEach-Object { ConvertTo-QuotedArg $_ }) -join ' ')
}

# ---------- process tracking ----------

function New-Tracker {
    return @{ Known = @{}; RootPid = 0 }
}

function Add-TrackerRoot($Tracker, [System.Diagnostics.Process]$Proc) {
    $Tracker.RootPid = $Proc.Id
    $Tracker.Known[[int]$Proc.Id] = @{ Name = $Proc.ProcessName; Created = $Proc.StartTime.AddSeconds(-2) }
}

function Update-Tracker($Tracker) {
    $all = @(Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, CreationDate, Name)
    $byId = @{}
    foreach ($q in $all) { $byId[[int]$q.ProcessId] = $q }
    do {
        $added = $false
        foreach ($q in $all) {
            $id = [int]$q.ProcessId
            if ($Tracker.Known.ContainsKey($id)) { continue }
            $parId = [int]$q.ParentProcessId
            $par = $Tracker.Known[$parId]
            if (-not $par) { continue }
            # A recorded PID that is alive now with another creation time was reused by an unrelated process; its children are not ours.
            $parNow = $byId[$parId]
            if ($parNow -and [math]::Abs(($parNow.CreationDate - $par.Created).TotalSeconds) -ge 3) { continue }
            if ($q.CreationDate -ge $par.Created) {
                $Tracker.Known[$id] = @{ Name = $q.Name; Created = $q.CreationDate }
                $added = $true
            }
        }
    } while ($added)
}

function Get-AliveTracked($Tracker) {
    $alive = @()
    $now = @{}
    foreach ($q in @(Get-CimInstance Win32_Process -Property ProcessId, CreationDate, Name)) { $now[[int]$q.ProcessId] = $q }
    foreach ($k in @($Tracker.Known.Keys)) {
        $e = $Tracker.Known[$k]
        $cur = $now[[int]$k]
        if ($cur -and [math]::Abs(($cur.CreationDate - $e.Created).TotalSeconds) -lt 3) {
            $alive += [pscustomobject]@{ pid = $k; name = $cur.Name; created = (ConvertTo-IsoTime $cur.CreationDate) }
        }
    }
    return $alive
}

function Stop-Tracked($Tracker) {
    $stopped = @()
    foreach ($a in @(Get-AliveTracked $Tracker)) {
        Stop-Process -Id $a.pid -Force -ErrorAction SilentlyContinue
        $stopped += $a
    }
    $deadline = (Get-Date).AddSeconds(5)
    while ((Get-Date) -lt $deadline -and @(Get-AliveTracked $Tracker).Count -gt 0) { Start-Sleep -Milliseconds 200 }
    return $stopped
}

function Get-RealPid($Tracker) {
    $c = $Tracker.Known.GetEnumerator() |
        Where-Object { $_.Key -ne $Tracker.RootPid -and $_.Value.Name -notin @('cmd.exe', 'conhost.exe') } |
        Sort-Object { $_.Value.Created } | Select-Object -First 1
    if ($c) { return [int]$c.Key }
    return $Tracker.RootPid
}

# Runs a child with file redirection and returns when it exits or the cap passes.
# OnTick may return a hashtable with verdict and reason to abort the child.
function Invoke-TrackedProcess {
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [string[]]$ArgumentList = @(),
        [string]$WorkingDirectory,
        [Parameter(Mandatory)][string]$StdoutPath,
        [Parameter(Mandatory)][string]$StderrPath,
        [Parameter(Mandatory)][string]$StdinPath,
        [Parameter(Mandatory)][int]$MaxSeconds,
        [int]$PollMs = 2000,
        [scriptblock]$OnTick
    )
    if (-not (Test-Path -LiteralPath $StdinPath)) { [IO.File]::WriteAllText($StdinPath, '') }
    $sp = @{
        FilePath = $FilePath
        RedirectStandardOutput = $StdoutPath
        RedirectStandardError = $StderrPath
        RedirectStandardInput = $StdinPath
        NoNewWindow = $true
        PassThru = $true
    }
    $joined = Join-ProcessArgs $ArgumentList
    if ($joined) { $sp.ArgumentList = $joined }
    if ($WorkingDirectory) { $sp.WorkingDirectory = $WorkingDirectory }
    $started = Get-Date
    $p = Start-Process @sp
    $null = $p.Handle
    $tracker = New-Tracker
    Add-TrackerRoot $tracker $p
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $timedOut = $false
    $aborted = $null
    $exited = $false
    # Any throw in the poll loop stops this call's own tree before it propagates; the caller never holds the tracker yet.
    try {
        while ($true) {
            $left = ($MaxSeconds * 1000) - $sw.ElapsedMilliseconds
            if ($left -le 0) { $timedOut = $true; break }
            $slice = if ($sw.ElapsedMilliseconds -lt 5000) { 500 } else { $PollMs }
            if ($p.WaitForExit([int][math]::Min($slice, $left))) { $exited = $true; break }
            Update-Tracker $tracker
            if ($OnTick) {
                $r = & $OnTick
                if ($r) { $aborted = $r; break }
            }
        }
    } catch {
        $loopError = $_
        try { Update-Tracker $tracker } catch { }
        try { $null = Stop-Tracked $tracker } catch { }
        try { $p.Kill($true) } catch { }
        throw $loopError
    }
    Update-Tracker $tracker
    $code = $null
    if ($exited) { $code = $p.ExitCode }
    return [pscustomobject]@{
        ExitCode = $code
        TimedOut = $timedOut
        Aborted = $aborted
        Tracker = $tracker
        RootPid = $p.Id
        RealPid = (Get-RealPid $tracker)
        StartedAt = $started
        EndedAt = (Get-Date)
    }
}

# ---------- adb ----------

function Invoke-Adb {
    param([Parameter(Mandatory)][string[]]$AdbArgs, [int]$TimeoutSec = 20, [string]$Serial)
    if (-not $script:AdbTmp) { throw 'Initialize-Adb must run first' }
    $script:AdbSeq++
    $base = Join-Path $script:AdbTmp ('adb-' + $PID + '-' + $script:AdbSeq)
    $all = @()
    if ($Serial) { $all += @('-s', $Serial) }
    $all += $AdbArgs
    $stdin = $base + '.in'
    [IO.File]::WriteAllText($stdin, '')
    $p = Start-Process -FilePath $script:AdbPath -ArgumentList (Join-ProcessArgs $all) `
        -RedirectStandardOutput ($base + '.out') -RedirectStandardError ($base + '.err') -RedirectStandardInput $stdin `
        -NoNewWindow -PassThru
    $null = $p.Handle
    $res = [pscustomobject]@{ ExitCode = $null; TimedOut = $false; Out = ''; Err = '' }
    if ($p.WaitForExit($TimeoutSec * 1000)) {
        $res.ExitCode = $p.ExitCode
    } else {
        $res.TimedOut = $true
        try { $p.Kill($true) } catch { }
    }
    foreach ($ext in @('out', 'err')) {
        $f = $base + '.' + $ext
        $t = ''
        if (Test-Path -LiteralPath $f) { $t = [IO.File]::ReadAllText($f) }
        if ($ext -eq 'out') { $res.Out = $t.Trim() } else { $res.Err = $t.Trim() }
    }
    Remove-Item -LiteralPath ($base + '.out'), ($base + '.err'), $stdin -Force -ErrorAction SilentlyContinue
    return $res
}

# The first adb call may spawn the server, which inherits the redirect handles; run it once with output files that stay.
function Initialize-Adb([string]$Dir, [string]$AdbExe) {
    if ($AdbExe) { $script:AdbPath = $AdbExe }
    New-Item -ItemType Directory -Force -Path $Dir | Out-Null
    $script:AdbTmp = $Dir
    $out = Join-Path $Dir 'adb-start-server.out'
    $err = Join-Path $Dir 'adb-start-server.err'
    $in = Join-Path $Dir 'adb-start-server.in'
    [IO.File]::WriteAllText($in, '')
    $p = Start-Process -FilePath $script:AdbPath -ArgumentList 'start-server' -RedirectStandardOutput $out `
        -RedirectStandardError $err -RedirectStandardInput $in -NoNewWindow -PassThru
    $null = $p.Handle
    if (-not $p.WaitForExit(30000)) {
        try { $p.Kill($true) } catch { }
        return $false
    }
    return ($p.ExitCode -eq 0)
}

function Get-DeviceState([string]$Serial) {
    $r = Invoke-Adb -AdbArgs @('get-state') -Serial $Serial -TimeoutSec 10
    if ($r.TimedOut) { return 'unknown' }
    if ($r.ExitCode -eq 0 -and $r.Out -eq 'device') { return 'device' }
    return 'offline'
}

# Status is absent only when the device state is device and the call produced neither output nor an adb error.
# toybox pidof exits 1 for no match, so exit 0 or 1 with empty output and empty stderr counts as absent.
function Get-PackagePid([string]$Serial, [string]$Package) {
    $state = Get-DeviceState $Serial
    if ($state -eq 'offline') { return @{ Status = 'offline'; Pid = $null } }
    if ($state -eq 'unknown') { return @{ Status = 'unknown'; Pid = $null } }
    $r = Invoke-Adb -AdbArgs @('shell', 'pidof', $Package) -Serial $Serial -TimeoutSec 10
    if ($r.TimedOut) { return @{ Status = 'unknown'; Pid = $null } }
    if ($r.ExitCode -eq 0 -and $r.Out -match '^\d+') { return @{ Status = 'running'; Pid = [int]($r.Out -split '\s+')[0] } }
    if ($r.Out -eq '' -and $r.Err -eq '' -and ($r.ExitCode -eq 0 -or $r.ExitCode -eq 1)) { return @{ Status = 'absent'; Pid = $null } }
    return @{ Status = 'unknown'; Pid = $null }
}

function Get-DeviceInfo([string]$Serial) {
    $info = [ordered]@{
        serial = $Serial; model = $null; android = $null; webview = $null
        battery = [ordered]@{ level = $null; tempC = $null; charging = $null }; dataFreeKB = $null
    }
    if (-not $Serial) { return $info }
    $m = Invoke-Adb -AdbArgs @('shell', 'getprop', 'ro.product.model') -Serial $Serial
    if ($m.ExitCode -eq 0) { $info.model = $m.Out }
    $a = Invoke-Adb -AdbArgs @('shell', 'getprop', 'ro.build.version.release') -Serial $Serial
    if ($a.ExitCode -eq 0) { $info.android = $a.Out }
    $b = Invoke-Adb -AdbArgs @('shell', 'dumpsys', 'battery') -Serial $Serial
    if ($b.ExitCode -eq 0) {
        if ($b.Out -match 'level:\s*(\d+)') { $info.battery.level = [int]$Matches[1] }
        if ($b.Out -match 'temperature:\s*(\d+)') { $info.battery.tempC = [int]$Matches[1] / 10.0 }
        $info.battery.charging = ($b.Out -match '(AC|USB|Wireless) powered:\s*true')
    }
    $d = Invoke-Adb -AdbArgs @('shell', 'df', '/data') -Serial $Serial
    if ($d.ExitCode -eq 0) {
        $line = (($d.Out -split '\r?\n') | Select-Object -Last 1) -split '\s+'
        if ($line.Count -ge 4 -and $line[3] -match '^\d+$') { $info.dataFreeKB = [int64]$line[3] }
    }
    return $info
}

# ---------- result json ----------

function Get-CommitInfo([string]$Repo) {
    $head = (& git -C $Repo rev-parse HEAD 2>$null | Out-String).Trim()
    $branch = (& git -C $Repo rev-parse --abbrev-ref HEAD 2>$null | Out-String).Trim()
    $st = (& git -C $Repo --no-optional-locks status --short 2>$null | Out-String).Trim()
    return [ordered]@{ head = $head; dirty = ($st.Length -gt 0); branch = $branch }
}

function Write-JsonAtomic([string]$Path, $Object) {
    $json = $Object | ConvertTo-Json -Depth 10
    $tmp = $Path + '.tmp'
    [IO.File]::WriteAllText($tmp, $json, (New-Object System.Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $tmp -Destination $Path -Force
}

function New-Result {
    param([string]$CheckId, [string]$BuildKind, [int]$CapSec, [string]$Repo, [string]$Serial)
    $now = Get-Date
    return [ordered]@{
        schema = 1
        checkId = $CheckId
        commit = (Get-CommitInfo $Repo)
        build = [ordered]@{ kind = $BuildKind; apkSha256 = $null; versionName = $null }
        device = [ordered]@{ serial = $Serial; model = $null; android = $null; webview = $null
            battery = [ordered]@{ level = $null; tempC = $null; charging = $null }; dataFreeKB = $null }
        data = [ordered]@{ fixture = $null; bytes = $null; ceilingBytes = $null }
        startedAt = (ConvertTo-IsoTime $now)
        endedAt = $null
        durationSec = $null
        capSec = $CapSec
        phases = @()
        verdict = 'running'
        reason = $null
        evidence = [ordered]@{ log = $null; logcat = $null; screenshots = @(); phasesJson = $null; consoleTxt = $null }
        snapshot = $null
        _started = $now
    }
}

function Test-ResultSchema($R) {
    $problems = @()
    foreach ($k in @('schema', 'checkId', 'commit', 'build', 'device', 'startedAt', 'capSec', 'phases', 'verdict', 'evidence')) {
        if (-not $R.Contains($k)) { $problems += ('missing ' + $k) }
    }
    if ($R.Contains('build')) {
        if (-not $R.build.Contains('kind') -or $R.build.kind -notin @('debug', 'release', 'none')) { $problems += 'build.kind must be debug, release or none' }
    }
    if ($R.Contains('build') -and $R.build.Contains('artifactPath') -and $R.build.artifactPath -and -not $R.build.apkSha256) { $problems += 'build.apkSha256 required when an artifact is set' }
    if ($R.Contains('device') -and -not $R.device.Contains('serial')) { $problems += 'missing device.serial' }
    if ($R.Contains('verdict') -and $R.verdict -notin @('running', 'pass', 'fail', 'timeout', 'crash')) { $problems += 'bad verdict' }
    if ($R.Contains('verdict') -and $R.verdict -ne 'running') {
        foreach ($k in @('endedAt', 'durationSec', 'reason')) { if ($null -eq $R[$k]) { $problems += ('missing ' + $k) } }
    }
    return $problems
}

function Save-Result($R, [string]$Path) {
    $copy = [ordered]@{}
    foreach ($k in $R.Keys) { if ($k -ne '_started') { $copy[$k] = $R[$k] } }
    Write-JsonAtomic $Path $copy
}

function Complete-Result($R, [string]$Verdict, [string]$Reason, [string]$Path) {
    $end = Get-Date
    $R.verdict = $Verdict
    $R.reason = $Reason
    $R.endedAt = ConvertTo-IsoTime $end
    $R.durationSec = [math]::Round(($end - $R._started).TotalSeconds, 2)
    $problems = Test-ResultSchema $R
    if ($problems.Count -gt 0) {
        $R.verdict = 'fail'
        $R.reason = 'schema: ' + ($problems -join '; ')
    }
    Save-Result $R $Path
    return $R.verdict
}

# ---------- lock ----------

function Test-LockHeld([string]$Path) {
    try { $txt = [IO.File]::ReadAllText($Path) } catch { return $true }
    if ($txt -notmatch '^(\d+),(\d+)$') { return $true }
    $pr = Get-Process -Id ([int]$Matches[1]) -ErrorAction SilentlyContinue
    return [bool]($pr -and $pr.StartTime.Ticks -eq [int64]$Matches[2])
}

# Creates the lock file atomically. Returns false while another live process holds it; a lock left by a dead process is replaced.
function Enter-Lock([string]$Path) {
    for ($i = 0; $i -lt 2; $i++) {
        try {
            $fs = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
            $me = Get-Process -Id $PID
            $b = [Text.Encoding]::UTF8.GetBytes([string]$PID + ',' + $me.StartTime.Ticks)
            $fs.Write($b, 0, $b.Length)
            $fs.Dispose()
            return $true
        } catch [System.IO.IOException] {
            if (-not (Test-Path -LiteralPath $Path)) { continue }
            if (Test-LockHeld $Path) { return $false }
            Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
        }
    }
    return $false
}

function Exit-Lock([string]$Path) {
    try { $txt = [IO.File]::ReadAllText($Path) } catch { return }
    if ($txt -match '^(\d+),' -and [int]$Matches[1] -eq $PID) { Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue }
}

# ---------- bounded helper tools, device settings ----------

# Same contract as Invoke-Adb for any host tool: output goes to files, the wait is bounded, the kill acts on our own handle.
function Invoke-Bounded {
    param([Parameter(Mandatory)][string]$FilePath, [string[]]$ArgumentList = @(), [int]$TimeoutSec = 20)
    if (-not $script:AdbTmp) { throw 'Initialize-Adb must run first' }
    $script:AdbSeq++
    $base = Join-Path $script:AdbTmp ('tool-' + $PID + '-' + $script:AdbSeq)
    $stdin = $base + '.in'
    [IO.File]::WriteAllText($stdin, '')
    $p = Start-Process -FilePath $FilePath -ArgumentList (Join-ProcessArgs $ArgumentList) `
        -RedirectStandardOutput ($base + '.out') -RedirectStandardError ($base + '.err') -RedirectStandardInput $stdin `
        -NoNewWindow -PassThru
    $null = $p.Handle
    $res = [pscustomobject]@{ ExitCode = $null; TimedOut = $false; Out = ''; Err = '' }
    if ($p.WaitForExit($TimeoutSec * 1000)) {
        $res.ExitCode = $p.ExitCode
    } else {
        $res.TimedOut = $true
        try { $p.Kill($true) } catch { }
    }
    foreach ($ext in @('out', 'err')) {
        $f = $base + '.' + $ext
        $t = ''
        if (Test-Path -LiteralPath $f) { try { $t = [IO.File]::ReadAllText($f) } catch { $t = '' } }
        if ($ext -eq 'out') { $res.Out = $t.Trim() } else { $res.Err = $t.Trim() }
    }
    Remove-Item -LiteralPath ($base + '.out'), ($base + '.err'), $stdin -Force -ErrorAction SilentlyContinue
    return $res
}

# adb shell takes one command string; the device shell re-parses it, so quoting inside the string is the caller's.
function Invoke-AdbShell([string]$Serial, [string]$Command, [int]$TimeoutSec = 20) {
    return Invoke-Adb -AdbArgs @('shell', $Command) -Serial $Serial -TimeoutSec $TimeoutSec
}

function Get-GlobalSetting([string]$Serial, [string]$Name) {
    $r = Invoke-AdbShell $Serial ('settings get global ' + $Name) 10
    if ($r.TimedOut -or $r.ExitCode -ne 0) { return $null }
    return $r.Out
}

# Only the user whitelist counts; system entries are a different list and are not ours to change.
function Test-IdleWhitelisted([string]$Text, [string]$Package) {
    return [bool]($Text -match ('(?m)^user,' + [regex]::Escape($Package) + ',\d+\s*$'))
}

function Get-InstalledBuildInfo([string]$Serial, [string]$Package) {
    $r = Invoke-AdbShell $Serial ('dumpsys package ' + $Package) 30
    if ($r.TimedOut -or $r.ExitCode -ne 0 -or $r.Out -notmatch 'versionName=') { return $null }
    $vn = $null
    if ($r.Out -match 'versionName=(\S+)') { $vn = $Matches[1] }
    $dbg = ($r.Out -match '(?:pkgFlags|flags)=\[[^\]]*\bDEBUGGABLE\b')
    $vc = $null
    if ($r.Out -match 'versionCode=(\d+)') { $vc = [int64]$Matches[1] }
    # The signing digest is the package manager's own short id of the signing certificate set; it changes with the key.
    $sig = $null
    if ($r.Out -match 'signatures:\[([0-9a-fA-F,\s]+)\]') { $sig = ($Matches[1] -replace '\s', '').ToLowerInvariant() }
    return @{ Kind = $(if ($dbg) { 'debug' } else { 'release' }); VersionName = $vn; VersionCode = $vc; Signing = $sig }
}

# ---------- app-data snapshot helpers ----------

# Top-level entries of the app data dir that a snapshot never carries and a restore never removes: caches are rebuilt by the
# app, and lib is the package manager's link to the native libraries.
$script:SnapshotExcluded = @('cache', 'code_cache', 'lib')

function Test-SnapshotName([string]$Name) {
    return [bool]($Name -match '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}\z')
}

function Test-AppDataEntryName([string]$Name) {
    return [bool]($Name -match '^[A-Za-z0-9_][A-Za-z0-9._@+=-]*\z')
}

# Names of the app data entries a snapshot covers. Returns $null when the listing is unreadable or holds an unsafe name.
function Get-AppDataNames([string]$Serial, [string]$Package) {
    $r = Invoke-AdbShell $Serial ('run-as ' + $Package + ' ls -A') 20
    if ($r.TimedOut -or $r.ExitCode -ne 0) { return $null }
    $names = @()
    foreach ($l in ($r.Out -split '\r?\n')) {
        $n = $l.Trim()
        if ($n -eq '' -or $n -in $script:SnapshotExcluded) { continue }
        if (-not (Test-AppDataEntryName $n)) { return $null }
        $names += $n
    }
    return , @($names | Sort-Object)
}

# Disk usage per entry (du -sk, informational), the count of regular files and their exact byte sums per entry, read inside the
# app uid. Null when unreadable.
function Get-AppDataStats([string]$Serial, [string]$Package, [string[]]$Names) {
    $kb = [ordered]@{}
    $bytes = [ordered]@{}
    $files = 0
    if ($Names.Count -gt 0) {
        $d = Invoke-AdbShell $Serial ('run-as ' + $Package + ' du -sk ' + ($Names -join ' ')) 120
        if ($d.TimedOut -or $d.ExitCode -ne 0) { return $null }
        foreach ($l in ($d.Out -split '\r?\n')) {
            if ($l -match '^(\d+)\s+(\S+)$') { $kb[$Matches[2]] = [int64]$Matches[1] }
        }
        foreach ($n in $Names) { if (-not $kb.Contains($n)) { return $null } }
        # One line per regular file: size in bytes and path. The sizes are summed per top-level entry on this side.
        $c = Invoke-AdbShell $Serial ('run-as ' + $Package + ' find ' + ($Names -join ' ') + ' -type f -exec stat -c ''%s %n'' {} +') 600
        if ($c.TimedOut -or $c.ExitCode -ne 0) { return $null }
        foreach ($n in $Names) { $bytes[$n] = [int64]0 }
        foreach ($l in ($c.Out -split '\r?\n')) {
            if ($l.Trim() -eq '') { continue }
            if ($l -notmatch '^(\d+) ([^/]+)(/.*)?$') { return $null }
            if (-not $bytes.Contains($Matches[2])) { return $null }
            $bytes[$Matches[2]] += [int64]$Matches[1]
            $files++
        }
    }
    $total = 0
    foreach ($k in $kb.Keys) { $total += $kb[$k] }
    $totalBytes = [int64]0
    foreach ($k in $bytes.Keys) { $totalBytes += $bytes[$k] }
    return @{ Names = @($Names); Kb = $kb; Bytes = $bytes; Files = $files; TotalKb = $total; TotalBytes = $totalBytes }
}

# Compares two Get-AppDataStats results; returns the list of differences (empty when equal). The comparison uses the entry list,
# the file count and the exact byte sum per entry: du block counts depend on how the filesystem allocated the files and
# differ slightly between the app's own writes and an extraction of the same bytes, so they are reported but never compared.
function Compare-AppDataStats($Want, $Got) {
    $diff = @()
    if ((@($Want.Names) -join '|') -ne (@($Got.Names) -join '|')) { $diff += ('entries differ: want ' + (@($Want.Names) -join ',') + ' got ' + (@($Got.Names) -join ',')) }
    foreach ($k in $Want.Bytes.Keys) {
        if (-not $Got.Bytes.Contains($k) -or [int64]$Got.Bytes[$k] -ne [int64]$Want.Bytes[$k]) { $diff += ('bytes ' + $k + ': want ' + $Want.Bytes[$k] + ' got ' + $(if ($Got.Bytes.Contains($k)) { $Got.Bytes[$k] } else { 'absent' })) }
    }
    if ([int64]$Want.Files -ne [int64]$Got.Files) { $diff += ('file count: want ' + $Want.Files + ' got ' + $Got.Files) }
    return $diff
}

# Free space of /data in KB with one retry; a busy device can miss a single df call.
function Get-DataFreeKB([string]$Serial) {
    foreach ($i in 1..2) {
        $d = Invoke-Adb -AdbArgs @('shell', 'df', '/data') -Serial $Serial -TimeoutSec 30
        if (-not $d.TimedOut -and $d.ExitCode -eq 0) {
            $line = (($d.Out -split '\r?\n') | Select-Object -Last 1) -split '\s+'
            if ($line.Count -ge 4 -and $line[3] -match '^\d+$') { return [int64]$line[3] }
        }
    }
    return $null
}

function Get-TarPath {
    $c = Get-Command tar -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $c) { throw 'tar not found on PATH' }
    return $c.Source
}

function Get-WebViewInfo([string]$Serial) {
    $r = Invoke-AdbShell $Serial 'dumpsys webviewupdate' 20
    if (-not $r.TimedOut -and $r.ExitCode -eq 0 -and $r.Out -match 'Current WebView package \(name, version\):\s*\(([^,]+),\s*([^)]+)\)') {
        return @{ Package = $Matches[1].Trim(); Version = $Matches[2].Trim() }
    }
    return $null
}

# ---------- CDP probe ----------

function Get-NodePath {
    if (-not $script:NodePath) {
        $c = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $c) { throw 'node not found on PATH' }
        $script:NodePath = $c.Source
    }
    return $script:NodePath
}

# Every CDP call has its own timeout inside cdp.mjs and an outer kill here, so a target that never answers cannot hang a check.
# Kind: ok, no-target (nothing to talk to yet), timeout (answered nothing in time), error (connection or protocol failure).
function Invoke-Cdp {
    param([Parameter(Mandatory)][int]$Port, [Parameter(Mandatory)][string]$Expression, [int]$TimeoutMs = 5000, [string]$CdpScript, [int]$GraceSec = 5)
    if (-not $CdpScript) { $CdpScript = Join-Path $script:DeviceToolsDir 'cdp.mjs' }
    $r = Invoke-Bounded -FilePath (Get-NodePath) -TimeoutSec ([int][math]::Ceiling($TimeoutMs / 1000.0) + $GraceSec) `
        -ArgumentList @($CdpScript, [string]$Port, '--timeout', [string]$TimeoutMs, '-e', $Expression)
    $kind = 'error'
    if ($r.TimedOut) { $kind = 'timeout' }
    elseif ($r.ExitCode -eq 0) { $kind = 'ok' }
    elseif ($r.ExitCode -eq 2) { $kind = 'no-target' }
    elseif ($r.ExitCode -eq 3) { $kind = 'timeout' }
    return [pscustomobject]@{ Kind = $kind; Value = $r.Out; Err = $r.Err; ExitCode = $r.ExitCode; Killed = $r.TimedOut }
}

# ---------- adb forward ownership ----------

function Get-ForwardList([string]$Serial) {
    $r = Invoke-Adb -AdbArgs @('forward', '--list') -Serial $Serial -TimeoutSec 10
    if ($r.TimedOut -or $r.ExitCode -ne 0) { return $null }
    $rows = @()
    foreach ($l in ($r.Out -split '\r?\n')) {
        $f = $l.Trim() -split '\s+'
        if ($f.Count -ge 3) { $rows += [pscustomobject]@{ Serial = $f[0]; Local = $f[1]; Remote = $f[2] } }
    }
    return , $rows
}

function Test-LocalPortFree([int]$Port) {
    try {
        $l = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
        $l.Start()
        $l.Stop()
        return $true
    } catch { return $false }
}

function Test-ForwardMapsTo($List, [int]$Port, [int]$AppPid) {
    foreach ($row in $List) {
        if ($row.Local -eq ('tcp:' + $Port) -and $row.Remote -eq ('localabstract:webview_devtools_remote_' + $AppPid)) { return $true }
    }
    return $false
}

function New-CdpForward([string]$Serial, [string]$Package, [int]$PortMin, [int]$PortMax) {
    return @{ Serial = $Serial; Package = $Package; PortMin = $PortMin; PortMax = $PortMax; Port = $null; Pid = $null; Pids = @() }
}

# Removes only the forward this object created: the listed mapping must still point at a devtools socket of a pid we forwarded.
# An unreadable list leaves the forward in place rather than guessing.
function Remove-CdpForward($Fwd) {
    if (-not $Fwd.Port) { return }
    $list = Get-ForwardList $Fwd.Serial
    $mine = $false
    if ($null -ne $list) {
        foreach ($row in $list) {
            if ($row.Local -eq ('tcp:' + $Fwd.Port) -and $row.Remote -match '^localabstract:webview_devtools_remote_(\d+)$' -and [int]$Matches[1] -in $Fwd.Pids) { $mine = $true }
        }
    }
    if ($mine) { $null = Invoke-Adb -AdbArgs @('forward', '--remove', ('tcp:' + $Fwd.Port)) -Serial $Fwd.Serial -TimeoutSec 10 }
    $Fwd.Port = $null
    $Fwd.Pid = $null
}

# True only for a refusal about the requested local port: an existing forward ("cannot rebind existing socket") or a host
# listener that cannot be opened because another process owns the port ("cannot bind listener ... (10048)", "Address already in use").
# adb server failures such as "could not install *smartsocket* listener: cannot bind to 127.0.0.1:5037" mention the same words
# but concern the server itself; they are not a taken port and must fail at once.
function Test-ForwardPortTaken([string]$Err) {
    if ($Err -match '(?i)smartsocket') { return $false }
    return [bool]($Err -match '(?i)cannot rebind existing socket|cannot bind listener|address already in use|\(10048\)|\(98\)')
}

# Points a forward at the devtools socket of the app's current pid. After a relaunch the old forward is removed and a new one
# is made, so a collector never keeps a socket of a dead process. The mapping is checked against pidof before it is trusted.
function Update-CdpForward($Fwd) {
    $s = Get-PackagePid -Serial $Fwd.Serial -Package $Fwd.Package
    if ($s.Status -ne 'running') { return @{ Ok = $false; Reason = ('app ' + $s.Status) } }
    $list = Get-ForwardList $Fwd.Serial
    if ($null -eq $list) { return @{ Ok = $false; Reason = 'forward list unreadable' } }
    if ($Fwd.Port -and $Fwd.Pid -eq $s.Pid -and (Test-ForwardMapsTo $list $Fwd.Port $s.Pid)) { return @{ Ok = $true; Port = $Fwd.Port; Pid = $s.Pid } }
    if ($Fwd.Port) {
        Remove-CdpForward $Fwd
        $list = Get-ForwardList $Fwd.Serial
        if ($null -eq $list) { return @{ Ok = $false; Reason = 'forward list unreadable' } }
    }
    $used = @()
    foreach ($row in $list) { if ($row.Local -match '^tcp:(\d+)$') { $used += [int]$Matches[1] } }
    # --no-rebind: a port that another agent forwarded after the list was read is refused, never overwritten; the next port is tried.
    $port = $null
    $lastErr = ''
    foreach ($c in ($Fwd.PortMin..$Fwd.PortMax)) {
        if ($c -in $used -or -not (Test-LocalPortFree $c)) { continue }
        $f = Invoke-Adb -AdbArgs @('forward', '--no-rebind', ('tcp:' + $c), ('localabstract:webview_devtools_remote_' + $s.Pid)) -Serial $Fwd.Serial -TimeoutSec 10
        if (-not $f.TimedOut -and $f.ExitCode -eq 0) { $port = $c; break }
        if ($f.TimedOut -or -not (Test-ForwardPortTaken $f.Err)) { return @{ Ok = $false; Reason = ('adb forward failed: ' + $f.Err) } }
        $lastErr = $f.Err
    }
    if (-not $port) { return @{ Ok = $false; Reason = ('no free port in range; last adb error: ' + $lastErr) } }
    $Fwd.Port = $port
    $Fwd.Pid = $s.Pid
    $Fwd.Pids += $s.Pid
    $list2 = Get-ForwardList $Fwd.Serial
    $s2 = Get-PackagePid -Serial $Fwd.Serial -Package $Fwd.Package
    if ($null -eq $list2 -or -not (Test-ForwardMapsTo $list2 $port $s.Pid) -or $s2.Status -ne 'running' -or $s2.Pid -ne $s.Pid) {
        Remove-CdpForward $Fwd
        return @{ Ok = $false; Reason = 'forward identity check failed' }
    }
    return @{ Ok = $true; Port = $port; Pid = $s.Pid }
}

# ---------- settled memory attribution ----------

# Sandboxed WebView renderers carry the owning app's uid tag in the activity manager dump (u0a320i679 belongs to u0a320).
# Returns the isolated pids owned by the given app pids. Known is false when no app pid has a record, so the caller can
# fall back to an inclusive figure instead of guessing.
function Get-OwnedSandboxPids([string]$Text, [int[]]$AppPids) {
    $tags = @()
    foreach ($m in [regex]::Matches($Text, 'ProcessRecord\{[0-9a-f]+ (\d+):[^\s/}]+/(u\d+a\d+)\}')) {
        if ([int]$m.Groups[1].Value -in $AppPids) { $tags += $m.Groups[2].Value }
    }
    $owned = @()
    if ($tags.Count -gt 0) {
        foreach ($m in [regex]::Matches($Text, 'ProcessRecord\{[0-9a-f]+ (\d+):[^\s}]*/(u\d+a\d+)i\d+\}')) {
            $id = [int]$m.Groups[1].Value
            if ($m.Groups[2].Value -in $tags -and $id -notin $owned) { $owned += $id }
        }
    }
    return @{ Known = ($tags.Count -gt 0); Pids = $owned }
}

# ---------- crash and relaunch watch ----------

# Device-clock text usable with logcat -T. The crash scan filters by this start time; the log buffer is never cleared,
# because it also holds other sessions' evidence.
function Get-DeviceClock([string]$Serial) {
    $r = Invoke-AdbShell $Serial 'date ''+%m-%d %H:%M:%S.000''' 10
    if (-not $r.TimedOut -and $r.ExitCode -eq 0 -and $r.Out -match '^\d\d-\d\d \d\d:\d\d:\d\d\.\d{3}$') { return $r.Out }
    return $null
}

# Returns the first crash evidence in a threadtime logcat dump for the package, or $null.
# Kinds: java-crash, native-crash, renderer-gone. A renderer crash leaves the app process alive, so it is only visible here.
# With -Pids, a renderer-gone line from another pid is not ours. -IgnoreRendererGone is for an open relaunch window,
# where tearing the renderer down is intended.
function Find-CrashInLog([string]$Text, [string]$Package, [int[]]$Pids = @(), [switch]$IgnoreRendererGone) {
    $pkg = [regex]::Escape($Package)
    foreach ($line in ($Text -split '\r?\n')) {
        if ($line -match ('Process:\s*' + $pkg + '\s*,\s*PID')) { return @{ Kind = 'java-crash'; Line = $line.Trim() } }
        if ($line -match 'Fatal signal \d+' -and ($line -match $pkg -or $line -match 'sandboxed_process')) { return @{ Kind = 'native-crash'; Line = $line.Trim() } }
        if ($line -match ('>>> ' + $pkg + '(:\S+)? <<<')) { return @{ Kind = 'native-crash'; Line = $line.Trim() } }
        if (-not $IgnoreRendererGone -and $line -match '(?i)Render(er)? process (gone|crashed)|Render process \(\d+\)''s crash|onRenderProcessGone|RenderProcessGone') {
            $own = $true
            if ($Pids.Count -gt 0 -and $line -match '^\d\d-\d\d \d\d:\d\d:\d\d\.\d+\s+(\d+)\s+\d+\s+[A-Z]\s') { $own = ([int]$Matches[1] -in $Pids) }
            if ($own) { return @{ Kind = 'renderer-gone'; Line = $line.Trim() } }
        }
    }
    return $null
}

function Get-LogcatCrash($Watch, [switch]$IgnoreRendererGone) {
    $r = Invoke-AdbShell $Watch.Serial ('logcat -b crash,main -d -v threadtime -T ''' + $Watch.Since + '''') 30
    if ($r.TimedOut -or $r.ExitCode -ne 0) { return $null }
    return Find-CrashInLog -Text $r.Out -Package $Watch.Package -Pids ([int[]]$Watch.Pids) -IgnoreRendererGone:$IgnoreRendererGone
}

# Returns $null when the device clock cannot be read: without a start time the scan would blame old crashes.
function New-AppWatch {
    param([Parameter(Mandatory)][string]$Serial, [Parameter(Mandatory)][string]$Package, [int]$AbsentPolls = 2, [int]$UnknownPolls = 3)
    $clock = Get-DeviceClock $Serial
    if (-not $clock) { return $null }
    return @{ Serial = $Serial; Package = $Package; AbsentPolls = $AbsentPolls; UnknownPolls = $UnknownPolls
        StartClock = $clock; Since = $clock; Absent = 0; Unknown = 0; LastPid = $null; Pids = @(); SeenRunning = $false
        Window = $null; Relaunches = @() }
}

# An intended restart (force-stop, reload) declares its maximum gap. Inside the window a missing process is expected.
function Open-RelaunchWindow($Watch, [string]$Name, [int]$MaxGapSec) {
    # Before the first poll LastPid is empty; without a seed the first poll that still sees the old process would pass for the relaunch.
    # An unreadable seed is retried once; if it stays unreadable the window cannot tell the old process from the relaunched one,
    # so Test-AppWatch fails it as adb-unresponsive instead of guessing (a guess would turn into a false crash).
    $seedUnknown = $false
    if (-not $Watch.LastPid) {
        $seed = Get-PackagePid -Serial $Watch.Serial -Package $Watch.Package
        if ($seed.Status -eq 'unknown') { $seed = Get-PackagePid -Serial $Watch.Serial -Package $Watch.Package }
        if ($seed.Status -eq 'running') { $Watch.LastPid = [int]$seed.Pid }
        elseif ($seed.Status -eq 'unknown') { $seedUnknown = $true }
    }
    $Watch.Window = @{ Name = $Name; FromPid = $Watch.LastPid; MaxGapSec = $MaxGapSec; Opened = (Get-Date); Deadline = (Get-Date).AddSeconds($MaxGapSec); SeedUnknown = $seedUnknown }
    $Watch.Absent = 0
}

# The relaunched pid becomes the expected pid. Crash evidence that is not a renderer teardown is still reported, and the
# scan start moves to the clock read taken before that scan, so teardown lines of the window are never re-read later.
function Close-RelaunchWindow($Watch, [int]$ToPid) {
    $w = $Watch.Window
    if (-not $w) { return $null }
    $now = Get-DeviceClock $Watch.Serial
    $hit = Get-LogcatCrash $Watch -IgnoreRendererGone
    $Watch.Relaunches += [ordered]@{ name = $w.Name; fromPid = $w.FromPid; toPid = $ToPid; gapSec = [math]::Round(((Get-Date) - $w.Opened).TotalSeconds, 1) }
    $Watch.Window = $null
    $Watch.LastPid = $ToPid
    if ($ToPid -notin $Watch.Pids) { $Watch.Pids += $ToPid }
    $Watch.SeenRunning = $true
    $Watch.Absent = 0
    if ($now) { $Watch.Since = $now }
    return $hit
}

# One poll. Returns $null while healthy, else @{ verdict; reason } with verdict crash or fail.
# Unreadable adb never counts as absence: offline fails as device-offline and repeated timeouts fail as adb-unresponsive.
function Test-AppWatch($Watch) {
    if ($Watch.Window -and $Watch.Window.SeedUnknown) { return @{ verdict = 'fail'; reason = 'adb-unresponsive' } }
    $s =Get-PackagePid -Serial $Watch.Serial -Package $Watch.Package
    if ($s.Status -eq 'offline') { return @{ verdict = 'fail'; reason = 'device-offline' } }
    if ($s.Status -eq 'unknown') {
        $Watch.Unknown++
        if ($Watch.Unknown -ge $Watch.UnknownPolls) { return @{ verdict = 'fail'; reason = 'adb-unresponsive' } }
        return $null
    }
    $Watch.Unknown = 0
    $w = $Watch.Window
    if ($s.Status -eq 'running') {
        $Watch.Absent = 0
        $p = [int]$s.Pid
        if ($w) {
            if ($p -ne $w.FromPid) {
                $hit = Close-RelaunchWindow $Watch $p
                if ($hit) { return @{ verdict = 'crash'; reason = ($hit.Kind + ': ' + $hit.Line) } }
            }
        } else {
            if ($Watch.LastPid -and $p -ne $Watch.LastPid) {
                return @{ verdict = 'crash'; reason = ('app pid changed from ' + $Watch.LastPid + ' to ' + $p + ' outside an expected relaunch') }
            }
            $Watch.LastPid = $p
            if ($p -notin $Watch.Pids) { $Watch.Pids += $p }
            $Watch.SeenRunning = $true
        }
    }
    $hit = Get-LogcatCrash $Watch -IgnoreRendererGone:([bool]$Watch.Window)
    if ($hit) { return @{ verdict = 'crash'; reason = ($hit.Kind + ': ' + $hit.Line) } }
    if ($s.Status -eq 'absent') {
        if ($Watch.Window) {
            if ((Get-Date) -gt $Watch.Window.Deadline) {
                return @{ verdict = 'fail'; reason = ('relaunch window ' + $Watch.Window.Name + ' exceeded ' + $Watch.Window.MaxGapSec + ' s') }
            }
        } else {
            $Watch.Absent++
            if ($Watch.Absent -ge $Watch.AbsentPolls) {
                if ($Watch.SeenRunning) { return @{ verdict = 'crash'; reason = ('app process gone for ' + $Watch.Absent + ' consecutive polls') } }
                return @{ verdict = 'fail'; reason = 'app-not-running' }
            }
        }
    }
    return $null
}

# ---------- fixtures: data ceiling and hash-skipping push ----------

# Data ceiling of a check that moves a fixture (600 MiB). Every such check declares its own value and records it in data.ceilingBytes.
$script:DefaultFixtureCeilingBytes = 629145600

# A fixture above the declared ceiling is refused before anything runs on the device unless the caller allows it AND names a
# reason. Warning is set when a large fixture was allowed, so the result records why.
function Get-FixtureGate([int64]$Bytes, [int64]$CeilingBytes, [switch]$AllowLarge, [string]$AllowLargeReason) {
    if ($Bytes -le $CeilingBytes) { return @{ Ok = $true; Reason = $null; Warning = $null } }
    $over = 'fixture is ' + $Bytes + ' bytes, above the declared data ceiling of ' + $CeilingBytes + ' bytes'
    if (-not $AllowLarge) { return @{ Ok = $false; Reason = ('data-ceiling: ' + $over + '; -AllowLarge with a reason is required'); Warning = $null } }
    if ([string]::IsNullOrWhiteSpace($AllowLargeReason)) { return @{ Ok = $false; Reason = ('data-ceiling: ' + $over + '; -AllowLarge needs -AllowLargeReason'); Warning = $null } }
    return @{ Ok = $true; Reason = $null; Warning = ('warning: ' + $over + '; allowed because: ' + $AllowLargeReason.Trim()) }
}

# Fixtures live in shared storage only: a name without a path part, a directory below /sdcard whose segments never start with a dot.
function Test-RemoteFixtureName([string]$Name) {
    return [bool]($Name -match '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\z')
}

function Test-RemoteFixtureDir([string]$Dir) {
    return [bool]($Dir -match '^/sdcard(/[A-Za-z0-9][A-Za-z0-9._-]*)*\z')
}

# Status: ok (Sha set), absent (no such file), error (timeout or any other failure; the caller must not guess).
function Get-RemoteSha256([string]$Serial, [string]$Path, [int]$TimeoutSec = 300) {
    $r = Invoke-AdbShell $Serial ('sha256sum ' + $Path) $TimeoutSec
    if ($r.TimedOut) { return @{ Status = 'error'; Sha = $null; Detail = 'timeout' } }
    if ($r.ExitCode -eq 0 -and $r.Out -match '^([0-9a-fA-F]{64})\s') { return @{ Status = 'ok'; Sha = $Matches[1].ToUpperInvariant() } }
    if (($r.Out + ' ' + $r.Err) -match '(?i)no such file') { return @{ Status = 'absent'; Sha = $null } }
    return @{ Status = 'error'; Sha = $null; Detail = ($r.Out + ' ' + $r.Err).Trim() }
}

function Get-RemoteFileSize([string]$Serial, [string]$Path) {
    $r = Invoke-AdbShell $Serial ('stat -c %s ' + $Path) 20
    if (-not $r.TimedOut -and $r.ExitCode -eq 0 -and $r.Out -match '^\d+$') { return [int64]$r.Out }
    return $null
}

# Pushes a fixture unless the device already holds a file with the same SHA-256; then nothing is transferred.
# A pushed copy is hashed on the device and removed again when it differs, so a damaged copy never stays under the fixture name.
function Push-Fixture {
    param([Parameter(Mandatory)][string]$Serial, [Parameter(Mandatory)][string]$LocalPath, [Parameter(Mandatory)][string]$RemotePath, [int]$TimeoutSec = 1200)
    $res = @{ Ok = $false; Skipped = $false; Reason = $null; Sha256 = $null; Bytes = 0; Seconds = 0.0; MbPerSec = $null }
    $res.Bytes = (Get-Item -LiteralPath $LocalPath).Length
    $res.Sha256 = (Get-FileHash -LiteralPath $LocalPath -Algorithm SHA256).Hash
    $have = Get-RemoteSha256 $Serial $RemotePath
    if ($have.Status -eq 'error') { $res.Reason = 'device hash unreadable: ' + $have.Detail; return $res }
    if ($have.Status -eq 'ok' -and $have.Sha -eq $res.Sha256) { $res.Ok = $true; $res.Skipped = $true; return $res }
    $t0 = Get-Date
    $p = Invoke-Adb -AdbArgs @('push', $LocalPath, $RemotePath) -Serial $Serial -TimeoutSec $TimeoutSec
    $res.Seconds = [math]::Round(((Get-Date) - $t0).TotalSeconds, 2)
    if ($p.TimedOut) { $res.Reason = 'adb push exceeded ' + $TimeoutSec + ' s'; return $res }
    if ($p.ExitCode -ne 0) { $res.Reason = 'adb push failed: ' + $p.Out + ' ' + $p.Err; return $res }
    $res.MbPerSec = [math]::Round($res.Bytes / 1MB / [math]::Max($res.Seconds, 0.001), 2)
    $after = Get-RemoteSha256 $Serial $RemotePath
    if ($after.Status -ne 'ok' -or $after.Sha -ne $res.Sha256) {
        $null = Invoke-AdbShell $Serial ('rm -f ' + $RemotePath) 30
        $res.Reason = 'integrity: the pushed copy differs from the local file (device hash mismatch); the copy was removed'
        return $res
    }
    $res.Ok = $true
    return $res
}

# ---------- import phase ring and read-only app state ----------

# Terminal outcomes of the app's own import, as the ring records them. "import repaired" and other pre-commit marks are not terminal.
$script:ImportFailStatuses = 'declined|read-failed|repair-refused|unsavable|base-unreadable|conflict|unknown|failed|abandoned|refused'

# The app answers a conflict, and a refusal by a stale marker of its own page, with one rebuild (two attempts in all). The first
# attempt's mark is therefore not the end while the app is still retrying; only the last attempt's mark is.
$script:ImportAttempts = 2
$script:ImportRetryStatuses = 'conflict|refused'

# Seconds the app gets to start the second attempt after a retryable first-attempt mark. A refusal the app does not retry
# (for example a too-new backup) carries the same mark, so a retry that never starts ends the run as a failure after this time.
$script:DefaultRetryGraceSec = 120

# Returns @{ Done; Pass; Restart; Reason } for the first terminal import mark of a ring snapshot.
function Get-ImportOutcome($Ring) {
    foreach ($rec in @($Ring)) {
        $p = [string]$rec.phase
        if ($p -match '^import committed, attempt \d+$') { return @{ Done = $true; Pass = $true; Restart = $false; Reason = $p } }
        if ($p -match ('^import (' + $script:ImportFailStatuses + '), attempt (\d+)$')) {
            $status = $Matches[1]
            $attempt = [int]$Matches[2]
            if ($status -match ('^(' + $script:ImportRetryStatuses + ')$') -and $attempt -lt $script:ImportAttempts) { continue }
            return @{ Done = $true; Pass = $false; Restart = $false; Reason = ('import ended with ' + $status + ' (' + $p + ')') }
        }
    }
    return @{ Done = $false; Pass = $false; Restart = $false; Reason = $null }
}

# The import is over when the ring holds a terminal mark, or when the page restarted after the ring recorded "import commit start":
# the app reloads the page once the import committed, which ends the ring, so the commit start is then the last mark there is.
# A restart alone does not prove the commit (the page can also die or reload for another cause): Restart is set on that outcome
# so the caller requires a positive fact from the store before it calls the run a pass.
function Get-ImportDone($C, [int]$RetryGraceSec = $script:DefaultRetryGraceSec) {
    $o = Get-ImportOutcome $C.Best
    if ($o.Done) { return $o }
    if ($C.Restarted) {
        foreach ($rec in @($C.Best)) {
            if ([string]$rec.phase -match '^import commit start, attempt \d+$') {
                return @{ Done = $true; Pass = $true; Restart = $true; Reason = ('page restarted after "' + [string]$rec.phase + '"; the ring ends with the page') }
            }
        }
    }
    $best = @($C.Best)
    if ($best.Count -gt 0 -and $null -ne $C.LastNow) {
        $last = $best[$best.Count - 1]
        $lp = [string]$last.phase
        if ($lp -match ('^import (' + $script:ImportRetryStatuses + '), attempt (\d+)$') -and [int]$Matches[2] -lt $script:ImportAttempts) {
            $status = $Matches[1]
            $age = ([double]$C.LastNow - [double]$last.t) / 1000.0
            if ($age -gt $RetryGraceSec) {
                return @{ Done = $true; Pass = $false; Restart = $false; Reason = ('import ended with ' + $status + ' (' + $lp + '); no further attempt started within ' + $RetryGraceSec + ' s') }
            }
        }
    }
    return @{ Done = $false; Pass = $false; Restart = $false; Reason = $null }
}

# Boot state of the imported data at the end of the run: wizard (setup wizard showing), booted (past the loading screen, no wizard),
# still-loading (the loading screen did not go within the wait), unknown (booted, but the wizard probe was unreadable).
function Get-BootState($BootFinished, $WizardShown) {
    if ($BootFinished -ne $true) { return 'still-loading' }
    if ($WizardShown -eq $true) { return 'wizard' }
    if ($WizardShown -eq $false) { return 'booted' }
    return 'unknown'
}

# The verdict of a run whose import watch ended. Pass means the import committed: a restart-based done, or a boot that is still
# loading, needs the store to have grown (store2 entries after the run above the count before the import). The chaId census
# is not a criterion (see Get-AppDataCensus).
function Get-ImportVerdict($Outcome, $Start, $End, [string]$BootState, [double]$Seconds) {
    if (-not $Outcome.Pass) { return @{ Verdict = 'fail'; Reason = [string]$Outcome.Reason } }
    $s = $null
    $e = $null
    if ($Start) { $s = $Start.store2Entries }
    if ($End) { $e = $End.store2Entries }
    $growth = ''
    if ($null -ne $s -and $null -ne $e) { $growth = '; store2 entries ' + $s + ' to ' + $e }
    if ($Outcome.Restart -or $BootState -eq 'still-loading') {
        $why = $(if ($Outcome.Restart) { 'the page restarted after the commit start' } else { 'the imported data was still loading at the end' })
        if ($null -eq $s -or $null -eq $e) { return @{ Verdict = 'fail'; Reason = ($why + ', and the store census was unreadable, so the commit is not confirmed (boot: ' + $BootState + ')') } }
        if ($e -le $s) { return @{ Verdict = 'fail'; Reason = ($why + ', but the store did not grow' + $growth + ' (boot: ' + $BootState + ')') } }
    }
    return @{ Verdict = 'pass'; Reason = ('import committed in ' + $Seconds + ' s: ' + $Outcome.Reason + $growth + '; boot: ' + $BootState) }
}

# One poll expression: the ring, the page clock the ring is measured on, the wall clock, and whether the size-warning text shows.
function Get-RingPollExpression([string]$WarnPattern) {
    return 'JSON.stringify({ring: globalThis.__risuImportPhases ? globalThis.__risuImportPhases.snapshot() : null, now: performance.now(), epoch: Date.now(), warn: document.body ? new RegExp(' + (ConvertTo-Json $WarnPattern -Compress) + ').test(document.body.innerText) : false})'
}

# Collects ring snapshots like the established measurement collector: the longest snapshot wins (a page reload empties the ring),
# and each mark keeps the wall-clock time estimated at its first sight (poll receive time minus the mark's age on the page clock).
function New-RingCollector { return @{ Best = @(); Wall = @{}; Polls = 0; Misses = 0; Warn = $false; LastNow = $null; Restarted = $false } }

function Update-RingCollector($C, [string]$Value, [datetime]$ReceivedAt) {
    $C.Polls++
    try { $o = ($Value | ConvertFrom-Json) | ConvertFrom-Json -AsHashtable } catch { $C.Misses++; return }
    if ($null -eq $o -or -not ($o -is [hashtable])) { $C.Misses++; return }
    $C.Warn = [bool]$o.warn
    # The ring lives in the page. A page restart (the app reloads after it committed an import) shows as a page clock that went
    # backwards, or as a ring that vanished after marks had been seen; the new page starts with no ring.
    $hadMarks = ($C.Best.Count -gt 0)
    if ($null -ne $C.LastNow -and ([double]$o.now + 1000) -lt [double]$C.LastNow) { $C.Restarted = $true }
    $C.LastNow = [double]$o.now
    if ($hadMarks -and ($null -eq $o.ring -or @($o.ring).Count -eq 0)) { $C.Restarted = $true }
    if ($null -eq $o.ring) { $C.Misses++; return }
    $ring = @($o.ring)
    foreach ($rec in $ring) {
        $k = [string]$rec.phase + '@' + [string]$rec.t
        if (-not $C.Wall.ContainsKey($k)) { $C.Wall[$k] = $ReceivedAt.AddMilliseconds(-([double]$o.now - [double]$rec.t)) }
    }
    if ($ring.Count -gt 0 -and $ring.Count -ge $C.Best.Count) { $C.Best = $ring }
}

# One phases[] row per ring mark. A mark is an instant: durationSec runs to the next mark, the last mark has none.
function Get-RingPhaseRows($C) {
    $rows = @()
    $best = @($C.Best)
    for ($i = 0; $i -lt $best.Count; $i++) {
        $rec = $best[$i]
        $start = $C.Wall[[string]$rec.phase + '@' + [string]$rec.t]
        $end = $start
        $dur = 0.0
        if ($i + 1 -lt $best.Count) {
            $nx = $best[$i + 1]
            $end = $C.Wall[[string]$nx.phase + '@' + [string]$nx.t]
            $dur = ([double]$nx.t - [double]$rec.t) / 1000.0
        }
        $rows += [ordered]@{ name = [string]$rec.phase; startedAt = (ConvertTo-IsoTime $start); endedAt = (ConvertTo-IsoTime $end)
            durationSec = [math]::Round($dur, 3); note = 'ring mark; durationSec runs to the next mark'; ringMs = $rec.t; heapMiB = $rec.heapMiB }
    }
    return $rows
}

# The click that confirms the app's size-warning dialog. The warning text is rechecked inside the same page evaluation and only the
# Yes/OK button of the alert box that shows it is clicked (labels match case-insensitively: the English UI shows YES and OK), so a dialog that replaced the warning between the poll and the click
# (for example the incomplete-items question, whose Yes leaves data out) is never confirmed. Result: clicked or none.
function Get-ConfirmClickExpression([string]$WarnPattern) {
    return 'new Promise(r=>{const re=new RegExp(' + (ConvertTo-Json $WarnPattern -Compress) + ');const box=[...document.querySelectorAll("[data-alert-box]")].find(x=>re.test(x.innerText));if(!box){r("none");return}const b=[...box.querySelectorAll("button")].filter(b=>/^(\uC608|Yes|OK|\uD655\uC778)$/i.test(b.innerText.trim())).pop();if(b){b.click();r("clicked")}else r("none")})'
}

# Read-only look at the app data of a debuggable build, readable while the app runs. chaIdTokens counts the distinct text runs
# that start at "chaId" and end at the next comma in the store2 shard units. It is NOT a character count: the same id followed by
# different text counts more than once, and chat messages that carry a chaId are counted too. store2Entries is the number of
# entries in store2, the stable marker of how much the store holds. Null when unreadable.
function Get-AppDataCensus([string]$Serial, [string]$Package) {
    $c = Invoke-AdbShell $Serial ('run-as ' + $Package + ' sh -c ''cat store2/*-s* | grep -ao "chaId[^,]*" | sort -u | wc -l''') 60
    $e = Invoke-AdbShell $Serial ('run-as ' + $Package + ' sh -c ''ls store2 | wc -l''') 60
    $tokens = $null
    $entries = $null
    if (-not $c.TimedOut -and $c.ExitCode -eq 0 -and $c.Out -match '^\d+$') { $tokens = [int]$c.Out }
    if (-not $e.TimedOut -and $e.ExitCode -eq 0 -and $e.Out -match '^\d+$') { $entries = [int]$e.Out }
    return [ordered]@{ chaIdTokens = $tokens; store2Entries = $entries; source = 'run-as store2 shard units (read-only)'; note = 'chaIdTokens is not a character count' }
}
