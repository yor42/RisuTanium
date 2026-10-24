# Makes the phone's 127.0.0.1:<Port> reach the PC's mock endpoint (mock-openai.mjs) through adb reverse, and writes <OutDir>\result.json.
# Adds exactly one rule, tcp:<Port> to tcp:<Port>, after the PC listener on 127.0.0.1:<Port> was seen, and reads the rule back from
# 'reverse --list'. An identical rule is left as it is; a rule for the same device port that points elsewhere is refused, never replaced.
# -Remove removes only tcp:<Port> (never --remove-all) and only when it is our identical rule.
# -Probe runs the phone-side connection probe 'echo x | toybox nc -w 3 127.0.0.1 <Port>' after the rule is verified. The probe runs as
# the adb shell user, not as the app, so it proves only the reverse rule and the PC listener; it does not settle what the app can reach.
# The probe's pass criterion is a client-error line in the mock's log at or after the probe start time (result field probe.startedUtc).
# nc's exit code and output are reported but never decide the verdict. The probe's bytes are not HTTP, so its signature is a connect
# line then a client-error line. The listener check sends an HTTP ping, so its footprint is a request line and never a client-error.
param(
    [Parameter(Mandatory)][string]$OutDir,
    [Parameter(Mandatory)][string]$Serial,
    [string[]]$AllowedSerials,
    [ValidateRange(1, 65535)][int]$Port = 6250,
    [switch]$Remove,
    [switch]$Probe,
    [ValidateRange(1, 600)][int]$MaxSeconds = 60,
    [string]$RepoRoot,
    [string]$AdbExe
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib.ps1')
Disable-StdHandleInherit
if (-not $RepoRoot) { $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path }
if (-not $AllowedSerials) { $AllowedSerials = @($script:DefaultSerial) }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$resultPath = Join-Path $OutDir 'result.json'
$checkId = if ($Remove) { 'mock-reverse-remove' } else { 'mock-reverse' }
$rule = 'tcp:' + $Port
$r = New-Result -CheckId $checkId -BuildKind 'none' -CapSec $MaxSeconds -Repo $RepoRoot -Serial $Serial
$r.mockReverse = [ordered]@{ port = $Port; rule = ($rule + ' ' + $rule); listener = $null; before = $null; after = $null; action = $null; probe = $null
    probeCriterion = 'a client-error line in the mock log at or after probe.startedUtc; not the nc exit code' }

function Finish([string]$Verdict, [string]$Reason) {
    $v = Complete-Result $script:r $Verdict $Reason $script:resultPath
    Write-Output ('verdict=' + $v + ' reason=' + $script:r.reason + ' result=' + $script:resultPath)
    if ($v -eq 'pass') { exit 0 } else { exit 1 }
}

# True when something accepts a connection on 127.0.0.1:<Port> within the wait and takes an HTTP ping. The ping makes the mock log a
# request line, so this check never leaves the client-error line that the probe's pass criterion looks for.
function Test-LocalListener([int]$LocalPort) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $task = $client.ConnectAsync([System.Net.IPAddress]::Loopback, $LocalPort)
        if (-not $task.Wait(1500)) { return $false }
        if (-not $client.Connected) { return $false }
        $crlf = [string][char]13 + [string][char]10
        $ping = [System.Text.Encoding]::ASCII.GetBytes('GET /__ping HTTP/1.0' + $crlf + $crlf)
        $stream = $client.GetStream()
        $stream.WriteTimeout = 1500
        $stream.Write($ping, 0, $ping.Length)
        $stream.Flush()
        return $true
    } catch { return $false } finally { $client.Dispose() }
}

# Rows of 'adb reverse --list'. The last two columns are the device-side socket and the PC-side socket; the first column
# (the transport label) is not used. Returns $null when the list cannot be read.
function Get-ReverseList([string]$Device) {
    $x = Invoke-Adb -AdbArgs @('reverse', '--list') -Serial $Device -TimeoutSec 10
    if ($x.TimedOut -or $x.ExitCode -ne 0) { return $null }
    $rows = @()
    foreach ($l in ($x.Out -split '\r?\n')) {
        $f = $l.Trim() -split '\s+'
        if ($f.Count -ge 3) { $rows += [pscustomobject]@{ Remote = $f[$f.Count - 2]; Local = $f[$f.Count - 1] } }
    }
    return , $rows
}

# Our rule is present (Identical), absent, or the same device port points at another PC socket (Conflict).
function Get-RuleState($List, [string]$Wanted) {
    $state = 'absent'
    foreach ($row in $List) {
        if ($row.Remote -ne $Wanted) { continue }
        if ($row.Local -eq $Wanted) { return 'identical' }
        $state = 'conflict'
    }
    return $state
}

function Format-ReverseList($List) {
    return @($List | ForEach-Object { $_.Remote + ' ' + $_.Local })
}

try {
    if ($Serial -notin $AllowedSerials) { Finish 'fail' ('serial ' + $Serial + ' is not in the allowed list') }
    if ($Remove -and $Probe) { Finish 'fail' '-Probe needs the rule; it cannot be combined with -Remove' }
    if (-not $Remove) {
        $r.mockReverse.listener = (Test-LocalListener $Port)
        if (-not $r.mockReverse.listener) { Finish 'fail' ('no listener on 127.0.0.1:' + $Port + '; start mock-openai.mjs first') }
    }
    if (-not (Initialize-Adb -Dir (Join-Path $OutDir 'adb') -AdbExe $AdbExe)) { Finish 'fail' 'adb start-server failed' }
    if ((Get-DeviceState $Serial) -ne 'device') { Finish 'fail' 'device-offline' }
    $r.device = Get-DeviceInfo $Serial

    $list = Get-ReverseList $Serial
    if ($null -eq $list) { Finish 'fail' 'reverse list unreadable' }
    $r.mockReverse.before = Format-ReverseList $list
    $state = Get-RuleState $list $rule

    if ($Remove) {
        if ($state -eq 'conflict') { Finish 'fail' ('device port ' + $rule + ' is reversed to another target; not ours to remove') }
        if ($state -eq 'absent') {
            $r.mockReverse.action = 'none'
            $r.mockReverse.after = $r.mockReverse.before
            Finish 'pass' ('no rule ' + $rule + ' to remove')
        }
        $rm = Invoke-Adb -AdbArgs @('reverse', '--remove', $rule) -Serial $Serial -TimeoutSec 10
        $r.mockReverse.action = 'removed'
        if ($rm.TimedOut -or $rm.ExitCode -ne 0) { Finish 'fail' ('adb reverse --remove failed: ' + $rm.Err) }
        $after = Get-ReverseList $Serial
        if ($null -eq $after) { Finish 'fail' 'reverse list unreadable after removal' }
        $r.mockReverse.after = Format-ReverseList $after
        if ((Get-RuleState $after $rule) -ne 'absent') { Finish 'fail' ('rule ' + $rule + ' is still listed after removal') }
        Finish 'pass' ('rule ' + $rule + ' removed and read back')
    }

    if ($state -eq 'conflict') { Finish 'fail' ('device port ' + $rule + ' is already reversed to another target; refusing to replace it') }
    if ($state -eq 'identical') {
        $r.mockReverse.action = 'kept'
    } else {
        # --no-rebind: a rule another agent added after the list was read is refused, never overwritten.
        $add = Invoke-Adb -AdbArgs @('reverse', '--no-rebind', $rule, $rule) -Serial $Serial -TimeoutSec 10
        $r.mockReverse.action = 'added'
        if ($add.TimedOut -or $add.ExitCode -ne 0) { Finish 'fail' ('adb reverse failed: ' + $add.Err) }
    }
    $after = Get-ReverseList $Serial
    if ($null -eq $after) { Finish 'fail' 'reverse list unreadable after adding' }
    $r.mockReverse.after = Format-ReverseList $after
    if ((Get-RuleState $after $rule) -ne 'identical') { Finish 'fail' ('rule ' + $rule + ' is not listed after adding') }

    if ($Probe) {
        $probeStartUtc = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
        $pr = Invoke-AdbShell $Serial ('echo x | toybox nc -w 3 127.0.0.1 ' + $Port) 15
        $r.mockReverse.probe = [ordered]@{ ranAs = 'adb shell user, not the app'; startedUtc = $probeStartUtc; exitCode = $pr.ExitCode; timedOut = $pr.TimedOut; out = $pr.Out; err = $pr.Err }
    }
    $note = ''
    if ($Probe) { $note = '; probe ran, pass criterion is a client-error line in the mock log at or after probe.startedUtc, not the nc exit code' }
    Finish 'pass' ('rule ' + $rule + ' ' + $r.mockReverse.action + ' and read back' + $note)
} catch {
    Finish 'fail' ('runner exception: ' + $_.Exception.Message)
}
