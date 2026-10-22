# Installs a built APK on the test device and verifies it, writing <OutDir>\result.json.
# A debug APK is already signed with the stable debug key, so it is verified and installed as built; that keeps reinstalls
# over an existing install signature-compatible. A release APK, or any APK with -ResignThrowaway, is aligned and signed
# with the persistent TEST keystore (default %LOCALAPPDATA%\risu-test-signing\test-release.p12, override -TestKeystore),
# so later test builds update in place. That keystore is created once when missing and is never deleted. It is a TEST
# key for spare phones with a fixed non-secret password; it is never the release key, and no real keystore, key.txt or
# keystore.properties is read. Its certificate SHA-256 is printed on every signing run and recorded in result.json.
# A signature mismatch is reported (verdict fail, reason signature-mismatch) and
# nothing is uninstalled unless -AllowClear is given, because uninstalling wipes the app data.
param(
    [Parameter(Mandatory)][string]$OutDir,
    [Parameter(Mandatory)][ValidateSet('debug', 'release')][string]$Kind,
    [string]$Apk,
    [string]$Serial,
    [string[]]$AllowedSerials,
    [string]$Package,
    [switch]$ResignThrowaway,
    [string]$TestKeystore,
    [switch]$AllowClear,
    [ValidateRange(1, 1800)][int]$MaxSeconds = 600,
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
if (-not $Apk) {
    $name = if ($Kind -eq 'debug') { 'debug\app-universal-debug.apk' } else { 'release\app-universal-release-unsigned.apk' }
    $Apk = Join-Path $RepoRoot ('src-tauri\gen\android\app\build\outputs\apk\universal\' + $name)
}
if (-not $TestKeystore) { $TestKeystore = Join-Path $env:LOCALAPPDATA 'risu-test-signing\test-release.p12' }
# Fixed on purpose: this key only signs test builds for spare phones, so the password protects nothing.
$testKeyPass = 'risu-test-key'
$testKeyAlias = 'risu-test'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$resultPath = Join-Path $OutDir 'result.json'
$jdk = 'C:\Users\yor42\.gradle\jdks\azul_systems__inc_-21-amd64-windows.2'
$deadline = (Get-Date).AddSeconds($MaxSeconds)
$ksDir = Join-Path $OutDir ('ks-' + [guid]::NewGuid().ToString('N'))
$r = New-Result -CheckId ('sign-install-' + $Kind) -BuildKind $Kind -CapSec $MaxSeconds -Repo $RepoRoot -Serial $Serial
$r.install = [ordered]@{ apk = $Apk; resigned = $false; testKeystore = $null; testKeyCreated = $false; testKeySha256 = $null; pmPath = $null; runAs = $null; debuggable = $null; installOutput = $null }
$phase = $null

function Start-Phase([string]$Name) { $script:phase = @{ name = $Name; t = Get-Date } }
function End-Phase([string]$Note) {
    $e = Get-Date
    $script:r.phases += [ordered]@{ name = $script:phase.name; startedAt = (ConvertTo-IsoTime $script:phase.t); endedAt = (ConvertTo-IsoTime $e)
        durationSec = [math]::Round(($e - $script:phase.t).TotalSeconds, 2); note = $Note }
}
function Get-Remaining { return [int][math]::Floor(($script:deadline - (Get-Date)).TotalSeconds) }
function Invoke-Tool([string]$Exe, [string[]]$ToolArgs, [string]$Tag) {
    $left = Get-Remaining
    if ($left -le 0) { return [pscustomobject]@{ TimedOut = $true; ExitCode = $null; Out = ''; Err = '' } }
    $o = Join-Path $script:OutDir ($Tag + '.out'); $e = Join-Path $script:OutDir ($Tag + '.err')
    $run = Invoke-TrackedProcess -FilePath $Exe -ArgumentList $ToolArgs -StdoutPath $o -StderrPath $e `
        -StdinPath (Join-Path $script:OutDir ($Tag + '.in')) -MaxSeconds ([math]::Min(300, $left))
    if ($run.TimedOut) { $null = Stop-Tracked $run.Tracker }
    return [pscustomobject]@{ TimedOut = $run.TimedOut; ExitCode = $run.ExitCode; Out = ([IO.File]::ReadAllText($o)).Trim(); Err = ([IO.File]::ReadAllText($e)).Trim() }
}
function Finish([string]$Verdict, [string]$Reason) {
    if (Test-Path -LiteralPath $script:ksDir) { Remove-Item -LiteralPath $script:ksDir -Recurse -Force -ErrorAction SilentlyContinue }
    $v = Complete-Result $script:r $Verdict $Reason $script:resultPath
    Write-Output ('verdict=' + $v + ' reason=' + $script:r.reason + ' result=' + $script:resultPath)
    if ($v -eq 'pass') { exit 0 } else { exit 1 }
}

try {
    if ($Serial -notin $AllowedSerials) { Finish 'fail' ('serial ' + $Serial + ' is not in the allowed list') }
    if ($Package -notin $script:AllowedPackages) { Finish 'fail' ('package ' + $Package + ' is not in the allowed list') }
    $releaseKeyDir = [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE '.risu-signing')).TrimEnd('\') + '\'
    if ([IO.Path]::GetFullPath($TestKeystore).StartsWith($releaseKeyDir, [StringComparison]::OrdinalIgnoreCase)) {
        Finish 'fail' ('-TestKeystore must not be under the release key location ' + $releaseKeyDir + '; the test key never lives beside the release key')
    }
    if (-not (Test-Path -LiteralPath $Apk)) { Finish 'fail' ('apk not found: ' + $Apk) }
    $bt = Get-ChildItem (Join-Path $env:ANDROID_HOME 'build-tools') -Directory | Sort-Object { [version]($_.Name -replace '[^\d.].*$', '') } | Select-Object -Last 1
    if (-not $bt) { Finish 'fail' 'no Android build-tools found' }
    $env:JAVA_HOME = $jdk
    $apksigner = Join-Path $bt.FullName 'apksigner.bat'

    Start-Phase 'adb'
    if (-not (Initialize-Adb -Dir (Join-Path $OutDir 'adb') -AdbExe $AdbExe)) { Finish 'fail' 'adb start-server failed' }
    if ((Get-DeviceState $Serial) -ne 'device') { Finish 'fail' 'device-offline' }
    $r.device = Get-DeviceInfo $Serial
    End-Phase $null

    $toInstall = $Apk
    if ($Kind -eq 'release' -or $ResignThrowaway) {
        Start-Phase 'sign'
        $r.install.resigned = $true
        New-Item -ItemType Directory -Force -Path $ksDir | Out-Null
        $aligned = Join-Path $ksDir 'aligned.apk'
        $signed = Join-Path $OutDir 'signed.apk'
        $keytool = Join-Path $jdk 'bin\keytool.exe'
        $r.install.testKeystore = $TestKeystore
        $t = Invoke-Tool (Join-Path $bt.FullName 'zipalign.exe') @('-f', '-p', '4', $Apk, $aligned) 'zipalign'
        if ($t.TimedOut) { Finish 'timeout' 'zipalign exceeded the cap' }
        if ($t.ExitCode -ne 0) { Finish 'fail' ('zipalign exit ' + $t.ExitCode) }
        if (-not (Test-Path -LiteralPath $TestKeystore)) {
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $TestKeystore) | Out-Null
            # keytool writes to a unique file beside the target and the finished file is moved into place without overwriting,
            # so a half-written keystore never sits at the target and a concurrent first run cannot lose its valid keystore.
            $keystoreTemp = Join-Path (Split-Path -Parent $TestKeystore) ('.new-' + [guid]::NewGuid().ToString('N') + '.tmp')
            $t = Invoke-Tool $keytool @('-genkeypair', '-keystore', $keystoreTemp, '-storetype', 'PKCS12', '-storepass', $testKeyPass, '-keypass', $testKeyPass,
                '-alias', $testKeyAlias, '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000', '-dname', 'CN=risu-test') 'keytool'
            if ($t.TimedOut -or $t.ExitCode -ne 0) {
                if (Test-Path -LiteralPath $keystoreTemp) { Remove-Item -LiteralPath $keystoreTemp -Force -ErrorAction SilentlyContinue }
                if ($t.TimedOut) { Finish 'timeout' 'keytool exceeded the cap' }
                Finish 'fail' ('keytool exit ' + $t.ExitCode)
            }
            # test seam: simulates a concurrent run that finishes its keystore between the existence check and the move
            if ($env:RISU_TEST_KEYSTORE_RACE_SOURCE) { Copy-Item -LiteralPath $env:RISU_TEST_KEYSTORE_RACE_SOURCE -Destination $TestKeystore }
            try {
                Move-Item -LiteralPath $keystoreTemp -Destination $TestKeystore -ErrorAction Stop
                $r.install.testKeyCreated = $true
            } catch {
                # only this run's own temp file is removed; the target is never deleted here
                if (Test-Path -LiteralPath $keystoreTemp) { Remove-Item -LiteralPath $keystoreTemp -Force -ErrorAction SilentlyContinue }
                if (-not (Test-Path -LiteralPath $TestKeystore)) { Finish 'fail' ('could not place the test keystore: ' + $_.Exception.Message) }
            }
        }
        $t = Invoke-Tool $keytool @('-list', '-v', '-keystore', $TestKeystore, '-storepass', $testKeyPass, '-alias', $testKeyAlias) 'keytool-list'
        if ($t.TimedOut) { Finish 'timeout' 'keytool list exceeded the cap' }
        if ($t.ExitCode -ne 0) { Finish 'fail' ('keytool list exit ' + $t.ExitCode + ': ' + $t.Err) }
        if ($t.Out -notmatch 'SHA256:\s*([0-9A-Fa-f:]{95})') { Finish 'fail' 'test keystore certificate SHA-256 not found in keytool output' }
        $r.install.testKeySha256 = ($Matches[1] -replace ':', '').ToLowerInvariant()
        Write-Output ('test-key-sha256=' + $r.install.testKeySha256 + ' keystore=' + $TestKeystore + ' created=' + $r.install.testKeyCreated)
        $t = Invoke-Tool $apksigner @('sign', '--ks', $TestKeystore, '--ks-type', 'PKCS12', '--ks-key-alias', $testKeyAlias, '--ks-pass', ('pass:' + $testKeyPass), '--key-pass', ('pass:' + $testKeyPass), '--out', $signed, $aligned) 'apksigner-sign'
        if ($t.TimedOut) { Finish 'timeout' 'apksigner sign exceeded the cap' }
        if ($t.ExitCode -ne 0) { Finish 'fail' ('apksigner sign exit ' + $t.ExitCode) }
        Remove-Item -LiteralPath $ksDir -Recurse -Force
        $toInstall = $signed
        End-Phase 'test keystore kept'
    }

    Start-Phase 'verify-signature'
    $t = Invoke-Tool $apksigner @('verify', $toInstall) 'apksigner-verify'
    if ($t.TimedOut) { Finish 'timeout' 'apksigner verify exceeded the cap' }
    if ($t.ExitCode -ne 0) { Finish 'fail' ('apksigner verify exit ' + $t.ExitCode + ': ' + $t.Err) }
    $r.build.apkSha256 = (Get-FileHash -LiteralPath $toInstall -Algorithm SHA256).Hash
    End-Phase $null

    Start-Phase 'install'
    $left = Get-Remaining
    if ($left -le 0) { Finish 'timeout' 'cap reached before install' }
    $i = Invoke-Adb -AdbArgs @('install', '-r', $toInstall) -Serial $Serial -TimeoutSec ([math]::Min(600, $left))
    $r.install.installOutput = ($i.Out + ' ' + $i.Err).Trim()
    if ($i.TimedOut) { Finish 'timeout' 'adb install exceeded the cap' }
    if ($i.ExitCode -ne 0 -or $r.install.installOutput -notmatch 'Success') {
        if ($r.install.installOutput -match 'INSTALL_FAILED_UPDATE_INCOMPATIBLE|signatures do not match') {
            if (-not $AllowClear) {
                End-Phase 'rejected'
                Finish 'fail' 'signature-mismatch: the installed package is signed with a different key; nothing was changed. Uninstalling wipes the app data and needs -AllowClear'
            }
            $u = Invoke-Adb -AdbArgs @('uninstall', $Package) -Serial $Serial -TimeoutSec 60
            if ($u.ExitCode -ne 0) { Finish 'fail' ('uninstall failed: ' + $u.Out + ' ' + $u.Err) }
            $i = Invoke-Adb -AdbArgs @('install', $toInstall) -Serial $Serial -TimeoutSec ([math]::Min(600, [math]::Max(30, (Get-Remaining))))
            $r.install.installOutput = ($i.Out + ' ' + $i.Err).Trim()
            if ($i.ExitCode -ne 0 -or $r.install.installOutput -notmatch 'Success') { Finish 'fail' ('install after uninstall failed: ' + $r.install.installOutput) }
        } else {
            Finish 'fail' ('install failed: ' + $r.install.installOutput)
        }
    }
    End-Phase $r.install.installOutput

    Start-Phase 'verify-install'
    $pp = Invoke-Adb -AdbArgs @('shell', 'pm', 'path', $Package) -Serial $Serial
    $r.install.pmPath = $pp.Out
    if ($pp.ExitCode -ne 0 -or $pp.Out -notmatch '^package:') { Finish 'fail' ('pm path did not list the package: ' + $pp.Out + ' ' + $pp.Err) }
    $ra = Invoke-Adb -AdbArgs @('shell', 'run-as', $Package, 'id') -Serial $Serial
    $r.install.runAs = ($ra.Out + ' ' + $ra.Err).Trim()
    $r.install.debuggable = ($ra.ExitCode -eq 0 -and $ra.Out -match 'uid=')
    End-Phase $null
    if ($Kind -eq 'debug' -and -not $r.install.debuggable) { Finish 'fail' ('debug build is not debuggable: ' + $r.install.runAs) }
    Finish 'pass' ('installed, debuggable=' + $r.install.debuggable)
} catch {
    Finish 'fail' ('exception: ' + $_.Exception.Message)
}
