# Builds the signed release APK with the maintainer's signing key and verifies the signature. Run by the maintainer, in a
# normal interactive terminal; the vault prompts for its password.
# The four signing values come from a PowerShell SecretManagement vault (default RisuSigning) and exist only as process
# environment variables of the build (RISU_ANDROID_KEYSTORE, RISU_ANDROID_KEYSTORE_PASSWORD, RISU_ANDROID_KEY_ALIAS,
# RISU_ANDROID_KEY_PASSWORD, read by app/build.gradle.kts). They are removed in a finally block, never passed as command-line
# arguments, never written to disk and never printed.
# The script refuses an agent shell (CLAUDECODE or CLAUDE_CODE_ENTRYPOINT set) and a host without interactive input, and has no
# override for either. The build is the one build-apk.ps1 runs (same JDK 21, NDK check, generated-files preflight, Cargo target
# dir and lock). The output is verified with apksigner; only the signer certificate SHA-256 digest is printed. When
# %USERPROFILE%\.risu-signing\expected-cert-sha256.txt exists (a public fingerprint) a different digest fails the run, because
# an APK signed with another key cannot update an installed copy in place; without the file the run prints fingerprintCheck=none
# and a warning. The build runs without Gradle or Kotlin daemons and leftovers are stopped, so no process keeps the values. -Install needs an explicit -Serial and refuses a
# signature mismatch unless -AllowClear, which wipes the app data.
param(
    [string]$OutDir,
    [string]$Vault = 'RisuSigning',
    [string]$KeystorePathSecret = 'RisuKeystorePath',
    [string]$KeystorePasswordSecret = 'RisuKeystorePassword',
    [string]$KeyAliasSecret = 'RisuKeyAlias',
    [string]$KeyPasswordSecret = 'RisuKeyPassword',
    [ValidateRange(1, 1800)][int]$MaxSeconds = 1500,
    [string]$Target = 'aarch64',
    [switch]$Install,
    [string]$Serial,
    [switch]$AllowClear,
    [string]$RepoRoot,
    [string]$ScratchRoot,
    [string]$CargoTargetDir,
    [string]$AdbExe
)
$ErrorActionPreference = 'Stop'
if (-not (Get-Command Get-AndroidGeneratedMissing -ErrorAction SilentlyContinue)) { . (Join-Path $PSScriptRoot 'lib.ps1') }
$script:SigningEnvNames = @('RISU_ANDROID_KEYSTORE', 'RISU_ANDROID_KEYSTORE_PASSWORD', 'RISU_ANDROID_KEY_ALIAS', 'RISU_ANDROID_KEY_PASSWORD')
$script:SigningJdk = 'C:\Users\yor42\.gradle\jdks\azul_systems__inc_-21-amd64-windows.2'

function Test-AgentShell {
    return [bool]($env:CLAUDECODE -or $env:CLAUDE_CODE_ENTRYPOINT)
}

function Test-InteractiveHost {
    return ([Environment]::UserInteractive -and -not [Console]::IsInputRedirected)
}

# Returns the reason to refuse, or $null. The agent-shell check comes first so its reason is never masked.
function Get-SigningRefusal([bool]$Agent = (Test-AgentShell), [bool]$Interactive = (Test-InteractiveHost)) {
    if ($Agent) { return 'refused: this is an agent shell (CLAUDECODE or CLAUDE_CODE_ENTRYPOINT is set). Agents must never sign releases or read the vault; run this script yourself in a normal terminal' }
    if (-not $Interactive) { return 'refused: no interactive host. The vault password is typed at a prompt; run this script in a normal terminal' }
    return $null
}

# Default secret reader: SecretManagement. The vault must be a password-protected SecretStore; a locked store is unlocked
# once, interactively. Throws when a secret cannot be read; the message never contains a value.
function Read-VaultSecret([string]$VaultName, [string]$Name) {
    if (-not $script:VaultChecked) {
        foreach ($m in @('Microsoft.PowerShell.SecretManagement', 'Microsoft.PowerShell.SecretStore')) {
            if (-not (Get-Module -ListAvailable -Name $m)) { throw ('module ' + $m + ' is not installed (see SIGNING.md step 1)') }
        }
        Import-Module Microsoft.PowerShell.SecretManagement -ErrorAction Stop
        $reg = Get-SecretVault -Name $VaultName -ErrorAction SilentlyContinue
        if (-not $reg) { throw ('vault ' + $VaultName + ' is not registered (see SIGNING.md step 2)') }
        if ($reg.ModuleName -notmatch 'SecretStore') { throw ('vault ' + $VaultName + ' is not a SecretStore vault, so its password protection cannot be checked (see SIGNING.md step 2)') }
        Import-Module Microsoft.PowerShell.SecretStore -ErrorAction Stop
        if ((Get-SecretStoreConfiguration).Authentication -ne 'Password') { throw 'the SecretStore is not password-protected (see SIGNING.md step 2)' }
        $script:VaultChecked = $true
    }
    try {
        return (Get-Secret -Vault $VaultName -Name $Name -AsPlainText -ErrorAction Stop)
    } catch {
        if ($script:VaultUnlockTried) { throw }
        $script:VaultUnlockTried = $true
        Unlock-SecretStore
        return (Get-Secret -Vault $VaultName -Name $Name -AsPlainText -ErrorAction Stop)
    }
}

# Reads the four values through $Reader (VaultName, SecretName -> string). Returns the values by environment variable name,
# or the names of the secrets that were missing or empty; a value never appears in an error.
function Get-SigningSecrets([string]$VaultName, [string[]]$SecretNames, [scriptblock]$Reader) {
    $values = [ordered]@{}
    $missing = @()
    for ($i = 0; $i -lt 4; $i++) {
        $v = $null
        try { $v = & $Reader $VaultName $SecretNames[$i] } catch { $v = $null }
        if ([string]::IsNullOrEmpty([string]$v)) { $missing += $SecretNames[$i] } else { $values[$script:SigningEnvNames[$i]] = [string]$v }
    }
    return [pscustomobject]@{ Values = $values; Missing = $missing }
}

# The signer certificate digest from apksigner verify --print-certs output; $null unless exactly one signer is listed.
function Get-CertDigestFromText([string]$Text) {
    # apksigner prints "V2 Signer: certificate SHA-256 digest: ..." per signature scheme (older builds: "Signer #1 certificate ...").
    # One APK signed once lists the same digest under every scheme it carries, so all listed digests must agree.
    $who = '(?:Signer #\d+|V\d+(?:\.\d+)? Signer):?'
    $all = [regex]::Matches($Text, '(?im)^' + $who + ' certificate SHA-256 digest:\s*([0-9a-f]{64})\s*$')
    $any = [regex]::Matches($Text, '(?im)^' + $who + ' certificate SHA-256 digest:')
    if ($all.Count -eq 0 -or $all.Count -ne $any.Count) { return $null }
    $digests = @($all | ForEach-Object { $_.Groups[1].Value.ToLowerInvariant() } | Select-Object -Unique)
    if ($digests.Count -ne 1) { return $null }
    return $digests[0]
}

# Normalises a pasted fingerprint (colons, spaces, case); $null when it is not 64 hex digits.
function ConvertTo-CertDigest([string]$Text) {
    $h = ($Text -replace '[\s:]', '').ToLowerInvariant()
    if ($h -match '^[0-9a-f]{64}$') { return $h }
    return $null
}

# Returns a failure reason, or $null when no expected-fingerprint file exists or the digest matches it.
function Test-ExpectedCert([string]$ExpectedFile, [string]$Digest) {
    if (-not $ExpectedFile -or -not (Test-Path -LiteralPath $ExpectedFile -PathType Leaf)) { return $null }
    $want = ConvertTo-CertDigest ([IO.File]::ReadAllText($ExpectedFile))
    if (-not $want) { return 'the expected-cert-sha256.txt file does not hold a SHA-256 fingerprint (64 hex digits)' }
    if ($want -ne $Digest) { return ('certificate mismatch: the APK is signed with ' + $Digest + ' but the expected fingerprint is ' + $want + '. Wrong key; in-place updates would break') }
    return $null
}

function Get-BuildPreflight([string]$Repo) {
    if (-not (Test-Path -LiteralPath (Join-Path $script:SigningJdk 'bin\java.exe'))) { return ('JDK 21 not found at ' + $script:SigningJdk) }
    if (-not $env:NDK_HOME) { return 'NDK_HOME is not set' }
    $gen = @(Get-AndroidGeneratedMissing $Repo)
    if ($gen.Count -gt 0) { return ('generated Android files missing under ' + $Repo + ': ' + ($gen -join '; ') + '. See build-apk.ps1 for how to provide them') }
    return $null
}

# The build environment. Gradle and the Kotlin compiler run in the build process and not in a daemon, because a daemon
# outlives the build with the signing values in its environment. The two settings come last so they win over a user value.
function Get-ReleaseBuildEnvironment([string]$CargoDir) {
    $gradleOpts = (([string]$env:GRADLE_OPTS + ' -Dorg.gradle.daemon=false -Dkotlin.compiler.execution.strategy=in-process')).Trim()
    return @{ JAVA_HOME = $script:SigningJdk; ANDROID_NDK_HOME = $env:NDK_HOME; CARGO_TARGET_DIR = $CargoDir; GRADLE_OPTS = $gradleOpts }
}

# Stops Gradle daemons the build may have left (a single-use daemon started for incompatible JVM arguments). This stops every
# daemon of the project's Gradle version. Runs after the signing environment is cleared; never throws.
function Stop-ReleaseBuildLeftovers([string]$Repo, [string]$WorkDir) {
    try {
        $gw = Join-Path $Repo 'src-tauri\gen\android\gradlew.bat'
        if (-not (Test-Path -LiteralPath $gw -PathType Leaf)) { return }
        New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
        $savedJava = $env:JAVA_HOME
        $env:JAVA_HOME = $script:SigningJdk
        try {
            $run = Invoke-TrackedProcess -FilePath $gw -ArgumentList @('--stop') -WorkingDirectory (Split-Path $gw) -StdoutPath (Join-Path $WorkDir 'gradle-stop.out') `
                -StderrPath (Join-Path $WorkDir 'gradle-stop.err') -StdinPath (Join-Path $WorkDir 'gradle-stop.in') -MaxSeconds 60
            if ($run.TimedOut) { $null = Stop-Tracked $run.Tracker }
        } finally {
            if ($null -ne $savedJava) { $env:JAVA_HOME = $savedJava } else { Remove-Item Env:\JAVA_HOME -ErrorAction SilentlyContinue }
        }
    } catch { Write-Warning ('could not stop leftover Gradle daemons: ' + $_.Exception.Message) }
}

# The release build build-apk.ps1 runs, through Run-Check.ps1 in this process so the child build inherits the signing
# environment. A signed build writes app-universal-release.apk (build-apk.ps1 expects the -unsigned name).
function Invoke-ReleaseBuild([string]$Repo, [string]$BuildOut, [string]$ScratchDir, [string]$CargoDir, [int]$Cap, [string]$BuildTarget, [string]$RunCheckPath = (Join-Path $PSScriptRoot 'Run-Check.ps1'), [string]$PnpmPath) {
    $apkPath = Join-Path $Repo 'src-tauri\gen\android\app\build\outputs\apk\universal\release\app-universal-release.apk'
    if (-not $CargoDir) { $CargoDir = Join-Path $ScratchDir 'cargo-target-android-release' }
    $lockPath = $CargoDir + '.lock'
    New-Item -ItemType Directory -Force -Path $ScratchDir, $BuildOut | Out-Null
    if (-not (Enter-Lock $lockPath)) { return [pscustomobject]@{ ExitCode = 1; ApkPath = $apkPath; Reason = ('another release build holds ' + $lockPath); Started = $false } }
    try {
        New-Item -ItemType Directory -Force -Path $CargoDir | Out-Null
        $envMap = Get-ReleaseBuildEnvironment $CargoDir
        $pnpm = $PnpmPath
        if (-not $pnpm) { $pnpm = (Get-Command pnpm.cmd -CommandType Application | Select-Object -First 1).Source }
        $argv = @('tauri', 'android', 'build', '--apk', 'true', '--target', $BuildTarget)
        $null = & $RunCheckPath -CheckId 'sign-release' -OutDir $BuildOut -MaxSeconds $Cap -FilePath $pnpm -ArgumentList $argv `
            -WorkingDirectory $Repo -BuildKind release -Environment $envMap -ArtifactPath $apkPath -RepoRoot $Repo -KillLingering
        $code = $LASTEXITCODE
    } finally {
        Exit-Lock $lockPath
    }
    $reason = $null
    $rp = Join-Path $BuildOut 'result.json'
    if ($code -eq 0 -and (Test-Path -LiteralPath $rp)) {
        $res = Get-Content -LiteralPath $rp -Raw | ConvertFrom-Json -AsHashtable
        if ($res.build.artifactFresh -ne $true) { $code = 1; $reason = 'the signed APK was not rewritten by this build' }
    } elseif ($code -ne 0) { $reason = 'build failed (see ' + (Join-Path $BuildOut 'child.err.log') + ')' }
    return [pscustomobject]@{ ExitCode = $code; ApkPath = $apkPath; Reason = $reason; Started = $true }
}

function Get-ApkSignerPath {
    $bt = Get-ChildItem (Join-Path $env:ANDROID_HOME 'build-tools') -Directory -ErrorAction SilentlyContinue | Sort-Object { [version]($_.Name -replace '[^\d.].*$', '') } | Select-Object -Last 1
    if (-not $bt) { return $null }
    return (Join-Path $bt.FullName 'apksigner.bat')
}

# Default verifier: apksigner verify --print-certs. Returns the signer digest, or throws without echoing the tool output.
function Get-ApkCertDigest([string]$Apk, [string]$WorkDir) {
    $signer = Get-ApkSignerPath
    if (-not $signer) { throw 'no Android build-tools (apksigner) found under ANDROID_HOME' }
    New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
    $o = Join-Path $WorkDir 'apksigner.out'; $e = Join-Path $WorkDir 'apksigner.err'
    $env:JAVA_HOME = $script:SigningJdk
    $run = Invoke-TrackedProcess -FilePath $signer -ArgumentList @('verify', '--print-certs', $Apk) -StdoutPath $o -StderrPath $e -StdinPath (Join-Path $WorkDir 'apksigner.in') -MaxSeconds 120
    if ($run.TimedOut) { $null = Stop-Tracked $run.Tracker; throw 'apksigner verify exceeded its cap' }
    if ($run.ExitCode -ne 0) { throw ('apksigner verify failed with exit ' + $run.ExitCode) }
    $d = Get-CertDigestFromText ([IO.File]::ReadAllText($o))
    if (-not $d) { throw 'apksigner reported no single signer certificate digest' }
    return $d
}

# Default installer: adb -s <serial> install -r. Returns a failure reason or $null.
function Install-SignedApk([string]$Apk, [string]$SerialNo, [bool]$Clear, [string]$WorkDir, [string]$Adb) {
    if (-not $SerialNo) { return '-Install needs an explicit -Serial' }
    if (-not (Initialize-Adb -Dir (Join-Path $WorkDir 'adb') -AdbExe $Adb)) { return 'adb start-server failed' }
    if ((Get-DeviceState $SerialNo) -ne 'device') { return 'device-offline' }
    $pkg = $script:DefaultPackage
    $i = Invoke-Adb -AdbArgs @('install', '-r', $Apk) -Serial $SerialNo -TimeoutSec 600
    $txt = ($i.Out + ' ' + $i.Err).Trim()
    if (-not $i.TimedOut -and $i.ExitCode -eq 0 -and $txt -match 'Success') { return $null }
    if ($txt -match 'INSTALL_FAILED_UPDATE_INCOMPATIBLE|signatures do not match') {
        if (-not $Clear) { return 'signature-mismatch: the installed package is signed with a different key; nothing was changed. Uninstalling wipes the app data and needs -AllowClear' }
        Write-Warning '-AllowClear uninstalls the installed app, which WIPES ITS DATA, then installs this APK'
        $u = Invoke-Adb -AdbArgs @('uninstall', $pkg) -Serial $SerialNo -TimeoutSec 60
        if ($u.ExitCode -ne 0) { return ('uninstall failed: ' + $u.Out + ' ' + $u.Err) }
        $i = Invoke-Adb -AdbArgs @('install', $Apk) -Serial $SerialNo -TimeoutSec 600
        $txt = ($i.Out + ' ' + $i.Err).Trim()
        if ($i.ExitCode -ne 0 -or $txt -notmatch 'Success') { return ('install after uninstall failed: ' + $txt) }
        return $null
    }
    return ('install failed: ' + $txt)
}

# The whole run, with every outside effect behind a scriptblock so tests never touch a vault, Gradle or a phone.
# Returns Pass, Reason, ApkPath, ApkSha256 and CertSha256. The signing environment is set only around $Builder.
function Invoke-SignRelease {
    param(
        [Parameter(Mandatory)][string]$VaultName,
        [Parameter(Mandatory)][string[]]$SecretNames,
        [Parameter(Mandatory)][scriptblock]$Reader,
        [Parameter(Mandatory)][scriptblock]$Preflight,
        [Parameter(Mandatory)][scriptblock]$Builder,
        [Parameter(Mandatory)][scriptblock]$Verifier,
        [string]$ExpectedFile,
        [scriptblock]$Installer,
        [scriptblock]$Cleanup
    )
    $res = [pscustomobject]@{ Pass = $false; Reason = $null; ApkPath = $null; ApkSha256 = $null; CertSha256 = $null; FingerprintCheck = $null }
    $pre = & $Preflight
    if ($pre) { $res.Reason = [string]$pre; return $res }
    $sec = Get-SigningSecrets $VaultName $SecretNames $Reader
    if ($sec.Missing.Count -gt 0) {
        $res.Reason = ('secrets missing or unreadable in vault ' + $VaultName + ': ' + ($sec.Missing -join ', '))
        return $res
    }
    if (-not (Test-Path -LiteralPath $sec.Values['RISU_ANDROID_KEYSTORE'] -PathType Leaf)) {
        $res.Reason = ('the keystore file named by ' + $SecretNames[0] + ' does not exist')
        return $res
    }
    $buildStarted = $false
    try {
        foreach ($k in $sec.Values.Keys) { [Environment]::SetEnvironmentVariable($k, $sec.Values[$k]) }
        $buildStarted = $true
        $build = & $Builder
        # A builder that reports Started = $false (another build held the lock) started nothing, so there is nothing to clean up
        # and a daemon stop would hit the other build.
        if ($build -and $build.PSObject.Properties['Started'] -and $build.Started -eq $false) { $buildStarted = $false }
    } finally {
        foreach ($k in $script:SigningEnvNames) { Remove-Item -LiteralPath ('Env:\' + $k) -ErrorAction SilentlyContinue }
        $sec = $null
        if ($Cleanup -and $buildStarted) { try { & $Cleanup } catch { Write-Warning ('build cleanup failed: ' + $_.Exception.Message) } }
    }
    $res.ApkPath = $build.ApkPath
    if ($build.ExitCode -ne 0) { $res.Reason = if ($build.Reason) { [string]$build.Reason } else { 'build failed' }; return $res }
    if (-not (Test-Path -LiteralPath $build.ApkPath -PathType Leaf)) { $res.Reason = 'the signed APK was not produced'; return $res }
    $res.ApkSha256 = (Get-FileHash -LiteralPath $build.ApkPath -Algorithm SHA256).Hash.ToLowerInvariant()
    try { $res.CertSha256 = & $Verifier $build.ApkPath } catch { $res.Reason = 'signature verification failed: ' + $_.Exception.Message; return $res }
    $hasExpected = [bool]($ExpectedFile -and (Test-Path -LiteralPath $ExpectedFile -PathType Leaf))
    $bad = Test-ExpectedCert $ExpectedFile $res.CertSha256
    if ($bad) { $res.FingerprintCheck = 'failed'; $res.Reason = $bad; return $res }
    $res.FingerprintCheck = if ($hasExpected) { 'match' } else { 'none' }
    if ($Installer) {
        $ie = & $Installer $build.ApkPath
        if ($ie) { $res.Reason = [string]$ie; return $res }
    }
    $res.Pass = $true
    return $res
}

# Prints the fingerprint check outcome; a missing expected-fingerprint file is a visible warning, never a silent pass.
function Write-FingerprintStatus($Result, [string]$ExpectedPath) {
    if ($Result.FingerprintCheck) { Write-Output ('fingerprintCheck=' + $Result.FingerprintCheck) }
    if ($Result.FingerprintCheck -eq 'none') { Write-Warning ('the signing key was NOT compared with an expected fingerprint: ' + $ExpectedPath + ' does not exist. A wrong key would pass unnoticed and break in-place updates. See SIGNING.md step 5') }
}

if ($MyInvocation.InvocationName -eq '.') { return }

$refusal = Get-SigningRefusal
if ($refusal) { Write-Output ('verdict=FAIL reason=' + $refusal); exit 1 }
Disable-StdHandleInherit
if (-not $RepoRoot) { $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path }
if (-not $ScratchRoot) { $ScratchRoot = $script:ScratchRoot }
if (-not $OutDir) { $OutDir = Join-Path $ScratchRoot 'sign-release' }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$names = @($KeystorePathSecret, $KeystorePasswordSecret, $KeyAliasSecret, $KeyPasswordSecret)
$expected = Join-Path $env:USERPROFILE '.risu-signing\expected-cert-sha256.txt'
$installer = $null
if ($Install) { $installer = { param($apk) Install-SignedApk $apk $Serial $AllowClear.IsPresent $OutDir $AdbExe } }
$result = Invoke-SignRelease -VaultName $Vault -SecretNames $names `
    -Reader { param($v, $n) Read-VaultSecret $v $n } `
    -Preflight { Get-BuildPreflight $RepoRoot } `
    -Builder { Invoke-ReleaseBuild $RepoRoot (Join-Path $OutDir 'build') $ScratchRoot $CargoTargetDir $MaxSeconds $Target } `
    -Verifier { param($apk) Get-ApkCertDigest $apk (Join-Path $OutDir 'verify') } `
    -ExpectedFile $expected -Installer $installer `
    -Cleanup { Stop-ReleaseBuildLeftovers $RepoRoot (Join-Path $OutDir 'cleanup') }
if ($result.ApkPath) { Write-Output ('apk=' + $result.ApkPath) }
if ($result.ApkSha256) { Write-Output ('apkSha256=' + $result.ApkSha256) }
if ($result.CertSha256) { Write-Output ('certSha256=' + $result.CertSha256) }
Write-FingerprintStatus $result $expected
if ($result.Pass) { Write-Output 'verdict=PASS'; exit 0 }
Write-Output ('verdict=FAIL reason=' + $result.Reason)
exit 1
