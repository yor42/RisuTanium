# Prepares the test device for a check (MC-330 2) and writes <OutDir>\result.json.
# Changes exactly two things: the global stay_on_while_plugged_in setting and the user entry of the app in the device-idle
# whitelist (battery-optimisation exemption). Every change is read back. The originals are recorded in the state file
# BEFORE the first change and a repeated prep keeps the first recording, so -Revert always restores the true originals.
# -Revert restores only what was recorded, reads it back, and marks the state reverted.
# -ScreenOff leaves stay-awake and the wake key alone, for checks about screen-off behaviour.
param(
    [Parameter(Mandatory)][string]$OutDir,
    [switch]$Revert,
    [switch]$ScreenOff,
    [string]$Serial,
    [string[]]$AllowedSerials,
    [string]$Package,
    [string]$StatePath,
    [ValidateRange(1, 600)][int]$MaxSeconds = 120,
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
if (-not $StatePath) { $StatePath = Join-Path $script:ScratchRoot ('device-prep\' + $Serial + '.json') }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $StatePath) | Out-Null
$resultPath = Join-Path $OutDir 'result.json'
$checkId = if ($Revert) { 'device-prep-revert' } else { 'device-prep' }
$r = New-Result -CheckId $checkId -BuildKind 'none' -CapSec $MaxSeconds -Repo $RepoRoot -Serial $Serial
$r.prep = [ordered]@{ statePath = $StatePath; originals = $null; applied = $null; readback = $null; screenOff = [bool]$ScreenOff }

function Finish([string]$Verdict, [string]$Reason) {
    $v = Complete-Result $script:r $Verdict $Reason $script:resultPath
    Write-Output ('verdict=' + $v + ' reason=' + $script:r.reason + ' result=' + $script:resultPath)
    if ($v -eq 'pass') { exit 0 } else { exit 1 }
}
function Read-State {
    if (-not (Test-Path -LiteralPath $StatePath)) { return $null }
    return (Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json -AsHashtable)
}
function Get-WhitelistText { return (Invoke-AdbShell $Serial 'dumpsys deviceidle whitelist' 20) }
function Set-StayOn([string]$Value) {
    if ($Value -eq 'null') { $x = Invoke-AdbShell $Serial 'settings delete global stay_on_while_plugged_in' 10 }
    else { $x = Invoke-AdbShell $Serial ('settings put global stay_on_while_plugged_in ' + $Value) 10 }
    return (-not $x.TimedOut -and $x.ExitCode -eq 0)
}

try {
    if ($Serial -notin $AllowedSerials) { Finish 'fail' ('serial ' + $Serial + ' is not in the allowed list') }
    if ($Package -notin $script:AllowedPackages) { Finish 'fail' ('package ' + $Package + ' is not in the allowed list') }
    if (-not (Initialize-Adb -Dir (Join-Path $OutDir 'adb') -AdbExe $AdbExe)) { Finish 'fail' 'adb start-server failed' }
    if ((Get-DeviceState $Serial) -ne 'device') { Finish 'fail' 'device-offline' }
    $r.device = Get-DeviceInfo $Serial
    $state = Read-State

    if ($Revert) {
        if (-not $state -or -not $state.originals) { Finish 'fail' ('no recorded originals at ' + $StatePath) }
        $o = $state.originals
        $r.prep.originals = $o
        if ($state.reverted) { Finish 'fail' 'already reverted; prep again to record new originals' }
        $problems = @()
        if ($state.changedStayOn) {
            if (-not (Set-StayOn ([string]$o.stayOn))) { $problems += 'restoring stay_on_while_plugged_in failed' }
            $now = Get-GlobalSetting $Serial 'stay_on_while_plugged_in'
            if ($now -ne [string]$o.stayOn) { $problems += ('stay_on_while_plugged_in reads ' + $now + ', expected ' + $o.stayOn) }
        }
        if (-not $o.whitelisted) {
            $null = Invoke-AdbShell $Serial ('dumpsys deviceidle whitelist -' + $Package) 20
            $wl = Get-WhitelistText
            if ($wl.TimedOut -or $wl.ExitCode -ne 0 -or (Test-IdleWhitelisted $wl.Out $Package)) { $problems += 'idle whitelist entry still present' }
        }
        $r.prep.readback = [ordered]@{ stayOn = (Get-GlobalSetting $Serial 'stay_on_while_plugged_in'); whitelisted = (Test-IdleWhitelisted (Get-WhitelistText).Out $Package) }
        if ($problems.Count -gt 0) { Finish 'fail' ($problems -join '; ') }
        $state.reverted = $true
        Write-JsonAtomic $StatePath $state
        Finish 'pass' 'originals restored and read back'
    }

    if ($state -and -not $state.reverted -and $state.originals) {
        $o = $state.originals
        $r.prep.keptEarlierOriginals = $true
    } else {
        $stayOn = Get-GlobalSetting $Serial 'stay_on_while_plugged_in'
        $wl = Get-WhitelistText
        if ($null -eq $stayOn -or $wl.TimedOut -or $wl.ExitCode -ne 0) { Finish 'fail' 'could not read the original settings' }
        $o = [ordered]@{ stayOn = $stayOn; whitelisted = (Test-IdleWhitelisted $wl.Out $Package) }
        $state = [ordered]@{ serial = $Serial; package = $Package; recordedAt = (Get-IsoNow); originals = $o; changedStayOn = $false; reverted = $false }
        Write-JsonAtomic $StatePath $state
    }
    $r.prep.originals = $o

    $problems = @()
    if (-not $ScreenOff) {
        $state.changedStayOn = $true
        Write-JsonAtomic $StatePath $state
        if (-not (Set-StayOn '7')) { $problems += 'setting stay_on_while_plugged_in failed' }
        $now = Get-GlobalSetting $Serial 'stay_on_while_plugged_in'
        if ($now -ne '7') { $problems += ('stay_on_while_plugged_in reads ' + $now + ', expected 7') }
        $null = Invoke-AdbShell $Serial 'input keyevent KEYCODE_WAKEUP' 10
    }
    $null = Invoke-AdbShell $Serial ('dumpsys deviceidle whitelist +' + $Package) 20
    $wl = Get-WhitelistText
    $white = (-not $wl.TimedOut -and $wl.ExitCode -eq 0 -and (Test-IdleWhitelisted $wl.Out $Package))
    if (-not $white) { $problems += 'idle whitelist entry not present after adding' }
    $wake = Invoke-AdbShell $Serial 'dumpsys power' 20
    $wakeState = $null
    if ($wake.Out -match 'mWakefulness=(\w+)') { $wakeState = $Matches[1] }
    $r.prep.applied = [ordered]@{ stayOn = $(if ($ScreenOff) { $null } else { '7' }); whitelisted = $true }
    $r.prep.readback = [ordered]@{ stayOn = (Get-GlobalSetting $Serial 'stay_on_while_plugged_in'); whitelisted = $white; wakefulness = $wakeState }
    $r.device = Get-DeviceInfo $Serial
    if ($problems.Count -gt 0) { Finish 'fail' ($problems -join '; ') }
    Finish 'pass' 'settings applied and read back'
} catch {
    Finish 'fail' ('runner exception: ' + $_.Exception.Message)
}
