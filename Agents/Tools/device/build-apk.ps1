# Builds the Android APK through Run-Check.ps1 and records kind, sha256 and duration in <OutDir>\result.json.
# The Cargo target dir is warm by default: one dir per build kind under the scratch root; -CleanBuild empties it first.
# One build per kind at a time: a held lock refuses the run instead of waiting on Cargo's own file lock.
# A preflight fails early, naming the files, when the gitignored generated Android project files are missing from -RepoRoot.
# -Kind release refuses VITE_RISU_MODULE_FAULT (in -BuildEnv or the environment) and -Config. After the build it checks
# <RepoRoot>\dist with util/checkReleaseDist.mjs: a hit fails the run and rewrites result.json to fail.
# -Measure (release only) is the explicit opt-in for a measurement build: it sets VITE_RISU_MEASURE=1 and the post-build check
# runs --fault-only, so measurement markers pass while the fault switch is still refused. The output and result.json label the
# APK as a measurement build that is not for the release key. To keep the release key off it, -Measure refuses before building
# when keystore.properties exists or an RISU_ANDROID_* value is set (in -BuildEnv or the environment), and accepts only an
# unsigned APK this run wrote: a stale one, or a signed-name APK written by the run, fails and names the file not to use.
# sign-release.ps1 keeps the full check, so a measurement build cannot pass it.
# Reads no signing material. A release build signs with src-tauri/gen/android/keystore.properties when that file exists
# (existence is reported, the content is never read); sign-install.ps1 re-signs release output with the persistent test key.
param(
    [Parameter(Mandatory)][string]$OutDir,
    [ValidateSet('debug', 'release')][string]$Kind = 'debug',
    [ValidateRange(1, 1800)][int]$MaxSeconds = 1500,
    [switch]$CleanBuild,
    [switch]$Measure,
    [string]$Config,
    [string]$Target = 'aarch64',
    [hashtable]$BuildEnv = @{},
    [string]$RepoRoot,
    [string]$ScratchRoot
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib.ps1')
Disable-StdHandleInherit
if (-not $RepoRoot) { $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path }
if (-not $ScratchRoot) { $ScratchRoot = $script:ScratchRoot }
$jdk = 'C:\Users\yor42\.gradle\jdks\azul_systems__inc_-21-amd64-windows.2'
$missing = $null
# A release APK must not carry the module fault switch, and -Config could point the web build at another frontendDist, which
# would leave <RepoRoot>\dist the wrong folder to check afterwards. Both are refused before any prerequisite is looked at.
$releaseRefusal = $null
if ($Kind -eq 'release') {
    $releaseRefusal = Get-FaultFlagRefusal $BuildEnv
    if (-not $releaseRefusal -and $Config) { $releaseRefusal = 'refused: -Config is not accepted with -Kind release, because it can change the frontend folder the release dist check reads' }
}
if (-not $releaseRefusal -and $Measure -and $Kind -ne 'release') {
    # A debug build is not measured through this switch: it is not release-checked, so -Measure would label nothing.
    $releaseRefusal = 'refused: -Measure is only accepted with -Kind release'
}
if (-not $releaseRefusal -and $Measure) { $releaseRefusal = Get-MeasureSigningRefusal $RepoRoot $BuildEnv }
if ($releaseRefusal) { $missing = $releaseRefusal }
elseif (-not (Test-Path -LiteralPath (Join-Path $jdk 'bin\java.exe'))) { $missing = 'JDK 21 not found at ' + $jdk }
elseif (-not $env:NDK_HOME) { $missing = 'NDK_HOME is not set' }
else {
    # The generated Android project files are gitignored, so a git archive tree lacks them and Gradle would fail late. Nothing is
    # copied from another checkout: the files must come from a build or init done in this tree, or be copied by the person.
    $gen = @(Get-AndroidGeneratedMissing $RepoRoot)
    if ($gen.Count -gt 0) {
        $missing = 'generated Android files missing under ' + $RepoRoot + ': ' + ($gen -join '; ') + '. They are gitignored (src-tauri/gen/android/app/.gitignore: /src/main/**/generated, /proguard-tauri.pro), ' +
            'so a git archive tree does not contain them and the build would fail with "Unresolved reference: TauriActivity". ' +
            'Provide them in this tree before building: copy the whole generated directory and proguard-tauri.pro from a checkout where an Android build has run, or generate them there with the Tauri CLI (pnpm tauri android init). This script copies nothing.'
    }
}
if ($missing) {
    # A missing prerequisite is a recorded failure, never an exception without a result.json.
    New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
    $r = New-Result -CheckId ('build-apk-' + $Kind) -BuildKind $Kind -CapSec $MaxSeconds -Repo $RepoRoot -Serial $null
    $null = Complete-Result $r 'fail' $missing (Join-Path $OutDir 'result.json')
    Write-Output ('verdict=fail reason=' + $missing)
    exit 1
}

$targetDir = Join-Path $ScratchRoot ('cargo-target-android-' + $Kind)
$lockPath = $targetDir + '.lock'
New-Item -ItemType Directory -Force -Path $ScratchRoot, $OutDir | Out-Null

if (-not (Enter-Lock $lockPath)) {
    $r = New-Result -CheckId ('build-apk-' + $Kind) -BuildKind $Kind -CapSec $MaxSeconds -Repo $RepoRoot -Serial $null
    $null = Complete-Result $r 'fail' ('another ' + $Kind + ' build holds ' + $lockPath) (Join-Path $OutDir 'result.json')
    Write-Output ('verdict=fail reason=build lock held ' + $lockPath)
    exit 1
}
try {
    if ($CleanBuild -and (Test-Path -LiteralPath $targetDir)) {
        if ((Split-Path $targetDir -Parent) -ne $ScratchRoot -or (Split-Path $targetDir -Leaf) -notlike 'cargo-target-android-*') { throw 'refusing to clean an unexpected path' }
        Remove-Item -LiteralPath $targetDir -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $targetDir | Out-Null

    $props = Join-Path $RepoRoot 'src-tauri\gen\android\keystore.properties'
    if ($Kind -eq 'release' -and (Test-Path -LiteralPath $props)) {
        Write-Output 'note: keystore.properties exists, Gradle signs the release APK with it (content not read)'
    }

    $envMap = @{ JAVA_HOME = $jdk; ANDROID_NDK_HOME = $env:NDK_HOME; CARGO_TARGET_DIR = $targetDir }
    foreach ($k in $BuildEnv.Keys) { $envMap[$k] = $BuildEnv[$k] }
    if ($Measure) {
        $envMap['VITE_RISU_MEASURE'] = '1'
        Write-Output 'note: measurement build requested (VITE_RISU_MEASURE=1); the label is given only if the build passes'
    }

    $pnpm = (Get-Command pnpm.cmd -CommandType Application | Select-Object -First 1).Source
    $argv = @('tauri', 'android', 'build')
    if ($Kind -eq 'debug') { $argv += '--debug' }
    $argv += @('--apk', 'true', '--target', $Target)
    if ($Config) { $argv += @('--config', $Config) }

    $apkDir = Join-Path $RepoRoot ('src-tauri\gen\android\app\build\outputs\apk\universal\' + $Kind)
    $apkName = if ($Kind -eq 'debug') { 'app-universal-debug.apk' } else { 'app-universal-release-unsigned.apk' }

    $measureStart = Get-Date
    $rc = Join-Path $PSScriptRoot 'Run-Check.ps1'
    & $rc -CheckId ('build-apk-' + $Kind) -OutDir $OutDir -MaxSeconds $MaxSeconds -FilePath $pnpm -ArgumentList $argv `
        -WorkingDirectory $RepoRoot -BuildKind $Kind -Environment $envMap -ArtifactPath (Join-Path $apkDir $apkName) -RepoRoot $RepoRoot
    $code = $LASTEXITCODE
} finally {
    Exit-Lock $lockPath
}

# The web output Tauri embedded is checked before the APK is accepted: a release build that carries the fault switch or the
# measurement code fails here, and its result.json says so. The exit code and the result agree.
# A measurement build accepts only the unsigned APK this run wrote. A signed-name APK written by the run means Gradle found a
# signing source, and an unsigned one that was not rewritten is an earlier build's file.
$measureRefusal = $null
if ($Kind -eq 'release' -and $Measure) {
    $signedApk = Join-Path $apkDir 'app-universal-release.apk'
    $signedItem = Get-Item -LiteralPath $signedApk -ErrorAction SilentlyContinue
    if ($signedItem -and $signedItem.LastWriteTime -ge $measureStart.AddSeconds(-2)) {
        $measureRefusal = 'a signed-name APK was written by this measurement build, so a release signing source was used. Do not use the APK at ' + $signedApk
    } elseif ($code -eq 0) {
        $freshResultPath = Join-Path $OutDir 'result.json'
        $fresh = $false
        if (Test-Path -LiteralPath $freshResultPath -PathType Leaf) {
            $freshRes = Get-Content -LiteralPath $freshResultPath -Raw | ConvertFrom-Json -AsHashtable
            $fresh = ($freshRes['build'] -and $freshRes['build']['artifactFresh'] -eq $true)
        }
        if (-not $fresh) { $measureRefusal = 'the unsigned APK was not rewritten by this measurement build. Do not use the APK at ' + (Join-Path $apkDir $apkName) }
    }
}
if ($Kind -eq 'release' -and ($code -eq 0 -or $measureRefusal)) {
    $distRefusal = $measureRefusal
    if (-not $distRefusal) { $distRefusal = Get-ReleaseDistRefusal $RepoRoot -FaultOnly:$Measure }
    if (-not $distRefusal -and $Measure) {
        $resultPath = Join-Path $OutDir 'result.json'
        if (Test-Path -LiteralPath $resultPath -PathType Leaf) {
            $res = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json -AsHashtable
            $res['measure_build'] = $true
            $res['label'] = Get-MeasureBuildLabel
            Write-JsonAtomic $resultPath $res
        }
        Write-Output ('label=' + (Get-MeasureBuildLabel) + ' apk=' + (Join-Path $apkDir $apkName))
    }
    if ($distRefusal) {
        $reason = if ($measureRefusal) { $measureRefusal } else { $distRefusal + ' Do not use the APK at ' + (Join-Path $apkDir $apkName) }
        $resultPath = Join-Path $OutDir 'result.json'
        if (Test-Path -LiteralPath $resultPath -PathType Leaf) {
            $res = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json -AsHashtable
            $res['verdict'] = 'fail'
            $res['reason'] = $reason
            Write-JsonAtomic $resultPath $res
        } else {
            $r = New-Result -CheckId 'build-apk-release' -BuildKind 'release' -CapSec $MaxSeconds -Repo $RepoRoot -Serial $null
            $null = Complete-Result $r 'fail' $reason $resultPath
        }
        Write-Output ('verdict=fail reason=' + $reason)
        exit 1
    }
}
exit $code
