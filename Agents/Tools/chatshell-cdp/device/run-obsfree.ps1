# Runs the observer-free device series on a SPARE device: per trial, open the app fresh, run obsfree.mjs, then analyze.mjs.
# Never aim it at the MVP phone. The serial has no default.
#   pwsh -NoProfile -File run-obsfree.ps1 -Serial <spare serial> -Build smoke -Trials T1,F1 [-PlanOnly]
# Invariants:
# - Phase A has no side effects: it checks every argument and every output path, and -PlanOnly stops after it. Nothing is
#   created and adb is not called before Phase A has passed.
# - Output goes to -OutDir (default: a folder under the OS temp dir), which must lie outside the checkout and the tool folder.
#   The refusal is lexical: a junction that leads into the checkout is not seen.
# - Phase B fails closed: a failed adb start, wake, forward, node step or trial throws and stops the series. The forward this
#   script made is always removed, and HARNESS_CDP is cleared on the way out.
param(
    [Parameter(Mandatory = $true)][string]$Serial,
    [Parameter(Mandatory = $true)][string]$Build,
    [string[]]$Trials = @('T1', 'T2', 'T3', 'T4', 'T5', 'F1', 'F2', 'F3'),
    [int]$PortMin = 9460,
    [int]$PortMax = 9469,
    [string]$OutDir,
    [string]$AdbExe = 'adb',
    [switch]$PlanOnly
)
$ErrorActionPreference = 'Stop'

# ---------- Phase A: arguments and paths, no side effects ----------

$ObsFreeSpecs = @{
    T1 = @('still', '60'); T2 = @('still', '60'); T3 = @('still', '60'); T4 = @('still', '0'); T5 = @('still', '60')
    F1 = @('fling', '650', '600', '1500', '150'); F2 = @('fling', '550', '600', '1400', '120'); F3 = @('fling', '650', '600', '1450', '140')
}
$ToolDir = if ($env:CHATSHELL_CDP_DIR) { $env:CHATSHELL_CDP_DIR } else { Split-Path -Parent $PSScriptRoot }
$RepoRoot = $env:CHATSHELL_REPO_ROOT
if (-not $RepoRoot) {
    $RepoRoot = $PSScriptRoot
    1..4 | ForEach-Object { $RepoRoot = Split-Path -Parent $RepoRoot }
}

function Resolve-ChatshellPath([string]$Path) {
    return [IO.Path]::GetFullPath($ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path))
}

function Assert-ChatshellOutside([string]$Path, [string]$What) {
    $sep = [string][IO.Path]::DirectorySeparatorChar
    $full = (Resolve-ChatshellPath $Path).TrimEnd('\', '/') + $sep
    foreach ($root in @($RepoRoot, $ToolDir)) {
        $r = (Resolve-ChatshellPath $root).TrimEnd('\', '/') + $sep
        if ($full.StartsWith($r, [StringComparison]::OrdinalIgnoreCase)) { throw ($What + ' must be outside the checkout and the tool folder: ' + $full) }
    }
}

if ($Serial -notmatch '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$') { throw ('bad -Serial: ' + $Serial) }
if ($Build -notmatch '^[A-Za-z0-9_-]{1,40}$') { throw ('bad -Build (letters, digits, _ and - only, 1-40): ' + $Build) }

$TrialList = @()
foreach ($Item in $Trials) {
    foreach ($Name in ($Item -split ',')) {
        $Name = $Name.Trim()
        if ($Name -eq '') { continue }
        if (-not $ObsFreeSpecs.ContainsKey($Name)) { throw ('unknown trial: ' + $Name) }
        $TrialList += $Name
    }
}
if ($TrialList.Count -eq 0) { throw 'no trials given' }

if ($PortMin -lt 1024 -or $PortMin -gt $PortMax -or $PortMax -gt 65535) { throw ('bad port range: ' + $PortMin + '-' + $PortMax) }

if (-not $OutDir) { $OutDir = Join-Path ([IO.Path]::GetTempPath()) 'chatshell-cdp\out' }
$AdbDir = Join-Path $OutDir 'adb'
Assert-ChatshellOutside $OutDir '-OutDir'
Assert-ChatshellOutside $AdbDir 'adb dir'

if ($PlanOnly) {
    [pscustomobject]@{ Serial = $Serial; Build = $Build; Trials = $TrialList; OutDir = $OutDir; AdbDir = $AdbDir; PortMin = $PortMin; PortMax = $PortMax } | ConvertTo-Json -Compress
    exit 0
}

# ---------- Phase B: side effects ----------

$DeviceLib = Join-Path $RepoRoot 'Agents\Tools\device\lib.ps1'
if (-not (Test-Path -LiteralPath $DeviceLib)) { throw ('device/lib.ps1 not found: ' + $DeviceLib) }
. $DeviceLib
. (Join-Path $PSScriptRoot 'open-fresh.ps1')
Disable-StdHandleInherit

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
if (-not (Initialize-Adb $AdbDir $AdbExe)) { throw 'adb did not start' }
$env:HARNESS_SERIAL = $Serial
$env:HARNESS_OUT = $OutDir
$env:HARNESS_ADB = $AdbExe
$Fwd = New-CdpForward $Serial 'io.github.yor42.risutanium' $PortMin $PortMax
$Series = Join-Path $OutDir ('series-' + $Build + '.txt')
try {
    foreach ($Trial in $TrialList) {
        '--- ' + $Build + ' ' + $Trial
        Open-ObsFreeFreshChat -Serial $Serial -Fwd $Fwd
        $Spec = $ObsFreeSpecs[$Trial]
        & node (Join-Path $PSScriptRoot 'obsfree.mjs') $Build $Trial @Spec 2>&1 | Out-File -Append -Encoding utf8 $Series
        if ($LASTEXITCODE -ne 0) { throw ('obsfree.mjs failed for ' + $Trial + ' (exit ' + $LASTEXITCODE + '); the series stops') }
        if (Test-Path -LiteralPath $Series) { Get-Content -LiteralPath $Series -Tail 1 }
        & node (Join-Path $PSScriptRoot 'analyze.mjs') $Build $Trial 2>&1 | Select-Object -Last 3
        if ($LASTEXITCODE -ne 0) { throw ('analyze.mjs failed for ' + $Trial + ' (exit ' + $LASTEXITCODE + '); the series stops') }
    }
} finally {
    Remove-CdpForward $Fwd
    Remove-Item Env:HARNESS_CDP -ErrorAction SilentlyContinue
}
