# Pushes one fixture file to the test device's shared storage and writes <OutDir>\result.json.
# The transfer is skipped when the device already holds a file of that name with the same SHA-256 (the device hash is read with
# sha256sum); a pushed copy is hashed on the device again and removed when it differs. The data ceiling is declared by this
# check (-CeilingBytes); a fixture above it is refused before any adb call unless -AllowLarge and -AllowLargeReason are given.
# -Remove deletes the named fixture from the device instead of pushing. Fixtures live below /sdcard only.
param(
    [string]$CheckId = 'fixture-push',
    [Parameter(Mandatory)][string]$OutDir,
    [Parameter(Mandatory)][string]$FixturePath,
    [string]$RemoteName,
    [string]$RemoteDir = '/sdcard/Download',
    [int64]$CeilingBytes = 629145600,
    [switch]$AllowLarge,
    [string]$AllowLargeReason,
    [switch]$Remove,
    [ValidateRange(1, 7200)][int]$MaxSeconds = 1200,
    [string]$Serial,
    [string[]]$AllowedSerials,
    [string]$Package,
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
if (-not $RemoteName) { $RemoteName = Split-Path -Leaf $FixturePath }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$resultPath = Join-Path $OutDir 'result.json'
$r = New-Result -CheckId $CheckId -BuildKind 'none' -CapSec $MaxSeconds -Repo $RepoRoot -Serial $Serial
$r.data.fixture = $RemoteName
$r.data.ceilingBytes = $CeilingBytes
$r.warnings = @()
$r.push = $null
Save-Result $r $resultPath

function Finish([string]$Verdict, [string]$Reason) {
    $v = Complete-Result $script:r $Verdict $Reason $script:resultPath
    Write-Output ('verdict=' + $v + ' reason=' + $script:r.reason + ' result=' + $script:resultPath)
    if ($v -eq 'pass') { exit 0 } else { exit 1 }
}

try {
    if ($Serial -notin $AllowedSerials) { Finish 'fail' ('serial ' + $Serial + ' is not in the allowed list') }
    if ($Package -notin $script:AllowedPackages) { Finish 'fail' ('package ' + $Package + ' is not in the allowed list') }
    if (-not (Test-RemoteFixtureName $RemoteName)) { Finish 'fail' ('bad fixture name: ' + $RemoteName) }
    if (-not (Test-RemoteFixtureDir $RemoteDir)) { Finish 'fail' ('bad fixture directory: ' + $RemoteDir) }
    $remotePath = $RemoteDir + '/' + $RemoteName
    if (-not (Test-Path -LiteralPath $FixturePath -PathType Leaf)) { Finish 'fail' ('fixture not found: ' + $FixturePath) }
    $bytes = (Get-Item -LiteralPath $FixturePath).Length
    $r.data.bytes = $bytes
    $gate = Get-FixtureGate $bytes $CeilingBytes -AllowLarge:$AllowLarge -AllowLargeReason $AllowLargeReason
    if (-not $gate.Ok) { Finish 'fail' $gate.Reason }
    if ($gate.Warning) { $r.warnings += $gate.Warning; Write-Output $gate.Warning }

    if (-not (Initialize-Adb -Dir (Join-Path $OutDir 'adb') -AdbExe $AdbExe)) { Finish 'fail' 'adb start-server failed' }
    if ((Get-DeviceState $Serial) -ne 'device') { Finish 'fail' 'device-offline' }
    $r.device = Get-DeviceInfo $Serial

    if ($Remove) {
        $rm = Invoke-AdbShell $Serial ('rm -f ' + $remotePath) 60
        if ($rm.TimedOut -or $rm.ExitCode -ne 0) { Finish 'fail' ('rm failed: ' + $rm.Err) }
        $left = Get-RemoteSha256 $Serial $remotePath
        if ($left.Status -ne 'absent') { Finish 'fail' ('fixture is still on the device after rm (' + $left.Status + ')') }
        $r.push = [ordered]@{ removed = $true; remotePath = $remotePath }
        Finish 'pass' ('removed ' + $remotePath)
    }

    $t0 = Get-Date
    $pf = Push-Fixture -Serial $Serial -LocalPath $FixturePath -RemotePath $remotePath -TimeoutSec $MaxSeconds
    $r.push = [ordered]@{ remotePath = $remotePath; bytes = $pf.Bytes; sha256 = $pf.Sha256; skipped = $pf.Skipped; seconds = $pf.Seconds; mbPerSec = $pf.MbPerSec }
    $r.phases = @([ordered]@{ name = $(if ($pf.Skipped) { 'hash-skip' } else { 'push' }); startedAt = (ConvertTo-IsoTime $t0); endedAt = (Get-IsoNow)
        durationSec = [math]::Round(((Get-Date) - $t0).TotalSeconds, 2); note = $null })
    if (-not $pf.Ok) { Finish $(if ($pf.Reason -match 'exceeded') { 'timeout' } else { 'fail' }) $pf.Reason }
    Finish 'pass' $(if ($pf.Skipped) { 'skipped: the device already holds the same SHA-256' } else { 'pushed and verified by the device SHA-256' })
} catch {
    Finish 'fail' ('exception: ' + $_.Exception.Message)
}
