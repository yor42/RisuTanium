# Builds the Android APK through Run-Check.ps1 and records kind, sha256 and duration in <OutDir>\result.json.
# The Cargo target dir is warm by default: one dir per build kind under the scratch root; -CleanBuild empties it first.
# One build per kind at a time: a held lock refuses the run instead of waiting on Cargo's own file lock.
# A preflight fails early, naming the files, when the gitignored generated Android project files are missing from -RepoRoot.
# Reads no signing material. A release build signs with src-tauri/gen/android/keystore.properties when that file exists
# (existence is reported, the content is never read); sign-install.ps1 re-signs release output with the persistent test key.
param(
    [Parameter(Mandatory)][string]$OutDir,
    [ValidateSet('debug', 'release')][string]$Kind = 'debug',
    [ValidateRange(1, 1800)][int]$MaxSeconds = 1500,
    [switch]$CleanBuild,
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
if (-not (Test-Path -LiteralPath (Join-Path $jdk 'bin\java.exe'))) { $missing = 'JDK 21 not found at ' + $jdk }
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

    $pnpm = (Get-Command pnpm.cmd -CommandType Application | Select-Object -First 1).Source
    $argv = @('tauri', 'android', 'build')
    if ($Kind -eq 'debug') { $argv += '--debug' }
    $argv += @('--apk', 'true', '--target', $Target)
    if ($Config) { $argv += @('--config', $Config) }

    $apkDir = Join-Path $RepoRoot ('src-tauri\gen\android\app\build\outputs\apk\universal\' + $Kind)
    $apkName = if ($Kind -eq 'debug') { 'app-universal-debug.apk' } else { 'app-universal-release-unsigned.apk' }

    $rc = Join-Path $PSScriptRoot 'Run-Check.ps1'
    & $rc -CheckId ('build-apk-' + $Kind) -OutDir $OutDir -MaxSeconds $MaxSeconds -FilePath $pnpm -ArgumentList $argv `
        -WorkingDirectory $RepoRoot -BuildKind $Kind -Environment $envMap -ArtifactPath (Join-Path $apkDir $apkName) -RepoRoot $RepoRoot
    $code = $LASTEXITCODE
} finally {
    Exit-Lock $lockPath
}
exit $code
