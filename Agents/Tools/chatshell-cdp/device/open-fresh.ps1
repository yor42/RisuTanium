# Opens the app fresh on the device and brings the chat to the opener state. Dot-source device/lib.ps1 first, then this file
# (a second dot-source of lib.ps1 would reset its adb scratch state). Defines only Open-ObsFreeFreshChat.
# Invariants:
# - The serial is a parameter; there is no default device.
# - HARNESS_CDP is cleared first and set only after the forward is confirmed, so a node script never uses a stale port.
# - Every adb step and every node step is checked; a timeout or a nonzero exit throws before the next step, so no tap
#   is sent to an app that did not start.
function Open-ObsFreeFreshChat {
    param(
        [Parameter(Mandatory = $true)][string]$Serial,
        [Parameter(Mandatory = $true)]$Fwd
    )
    $Pkg = 'io.github.yor42.risutanium'
    Remove-Item Env:HARNESS_CDP -ErrorAction SilentlyContinue
    function Invoke-FreshShell([string]$Command) {
        $r = Invoke-AdbShell $Serial $Command
        if ($r.TimedOut -or $r.ExitCode -ne 0) { throw ('adb shell failed: ' + $Command + ' :: ' + $r.Err) }
    }
    function Invoke-FreshNode([string]$Script, [string[]]$ScriptArgs) {
        & node (Join-Path $PSScriptRoot $Script) @ScriptArgs
        if ($LASTEXITCODE -ne 0) { throw ('node ' + $Script + ' exited ' + $LASTEXITCODE) }
    }
    Invoke-FreshShell 'input keyevent KEYCODE_WAKEUP'
    Invoke-FreshShell ('am force-stop ' + $Pkg); Start-Sleep 2
    Invoke-FreshShell ('am start -n ' + $Pkg + '/.MainActivity'); Start-Sleep 8
    $up = Update-CdpForward $Fwd
    if (-not $up.Ok) { throw ('CDP forward failed: ' + $up.Reason) }
    $env:HARNESS_CDP = [string]$up.Port
    Invoke-FreshNode 'coldtap.mjs' @('30', '45'); Start-Sleep 1.5
    Invoke-FreshNode 'coldtap.mjs' @('40', '88'); Start-Sleep 4
    Invoke-FreshNode 'closeside.mjs' @()
}
