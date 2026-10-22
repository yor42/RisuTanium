# Installs a built APK on the test device and verifies it, writing <OutDir>\result.json.
# A debug APK is already signed with the stable debug key, so it is verified and installed as built; that keeps reinstalls
# over an existing install signature-compatible. A release APK, or any APK with -ResignThrowaway, is aligned and signed
# with a throwaway keystore generated under <OutDir> for this run and deleted afterwards. No existing keystore, key.txt
# or keystore.properties is read. A signature mismatch is reported (verdict fail, reason signature-mismatch) and
# nothing is uninstalled unless -AllowClear is given, because uninstalling wipes the app data.
param(
    [Parameter(Mandatory)][string]$OutDir,
    [Parameter(Mandatory)][ValidateSet('debug', 'release')][string]$Kind,
    [string]$Apk,
    [string]$Serial,
    [string[]]$AllowedSerials,
    [string]$Package,
    [switch]$ResignThrowaway,
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
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$resultPath = Join-Path $OutDir 'result.json'
$jdk = 'C:\Users\yor42\.gradle\jdks\azul_systems__inc_-21-amd64-windows.2'
$deadline = (Get-Date).AddSeconds($MaxSeconds)
$ksDir = Join-Path $OutDir ('ks-' + [guid]::NewGuid().ToString('N'))
$r = New-Result -CheckId ('sign-install-' + $Kind) -BuildKind $Kind -CapSec $MaxSeconds -Repo $RepoRoot -Serial $Serial
$r.install = [ordered]@{ apk = $Apk; resigned = $false; pmPath = $null; runAs = $null; debuggable = $null; installOutput = $null }
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
        $pw = [guid]::NewGuid().ToString('N')
        $t = Invoke-Tool (Join-Path $bt.FullName 'zipalign.exe') @('-f', '-p', '4', $Apk, $aligned) 'zipalign'
        if ($t.TimedOut) { Finish 'timeout' 'zipalign exceeded the cap' }
        if ($t.ExitCode -ne 0) { Finish 'fail' ('zipalign exit ' + $t.ExitCode) }
        $t = Invoke-Tool (Join-Path $jdk 'bin\keytool.exe') @('-genkeypair', '-keystore', (Join-Path $ksDir 'throwaway.jks'), '-storepass', $pw, '-keypass', $pw,
            '-alias', 't', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '30', '-dname', 'CN=throwaway') 'keytool'
        if ($t.TimedOut) { Finish 'timeout' 'keytool exceeded the cap' }
        if ($t.ExitCode -ne 0) { Finish 'fail' ('keytool exit ' + $t.ExitCode) }
        $t = Invoke-Tool $apksigner @('sign', '--ks', (Join-Path $ksDir 'throwaway.jks'), '--ks-pass', ('pass:' + $pw), '--key-pass', ('pass:' + $pw), '--out', $signed, $aligned) 'apksigner-sign'
        if ($t.TimedOut) { Finish 'timeout' 'apksigner sign exceeded the cap' }
        if ($t.ExitCode -ne 0) { Finish 'fail' ('apksigner sign exit ' + $t.ExitCode) }
        Remove-Item -LiteralPath $ksDir -Recurse -Force
        $toInstall = $signed
        End-Phase 'throwaway keystore deleted'
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
