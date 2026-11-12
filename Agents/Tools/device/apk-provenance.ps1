# apk-provenance.ps1 -DistPath <absolute dist folder> [-ApkPath <absolute APK>] -Expect present|absent [-Marker <text>]
# DIRTY-RC provenance check (plan r5 E4, r4 Bars): does the build's frontend contain the patched-Svelte marker?
# The marker is the PATCH_ID prefix 'risu-proxy-patch svelte@5.57.3', which the install-time error-sink label keeps in every
# build that has the hook. A base build must lack it (-Expect absent) and a branch build must contain it (-Expect present); a run
# whose build has the wrong provenance is void.
# A Tauri APK holds the frontend compressed inside its native library, so there is no JS to read in the APK (README "Confirm the
# build"). The JS is readable in the dist folder the build produced; run this right after the build, on that dist folder, and
# keep its output with the APK record. The dist content hash printed here and the APK SHA-256 bind the dist that was checked to
# the APK that was installed: lane B records both lines for the same build.
# It reads every .js, .mjs and .cjs file under -DistPath as text and prints: the dist content hash (SHA-256 over the sorted
# relative paths, each followed by the SHA-256 of that file's bytes, over every file under the folder), the number of JS files
# searched, the files that contain the marker, the APK SHA-256 when -ApkPath is given, and the verdict.
# Exit codes: 0 the dist matches -Expect, 1 it does not, 2 usage or read error (including a dist folder with no JS file, which
# cannot prove anything).
# Safety: reads only the dist folder and the APK file it is given (hash only); no zip handling, no signing material, no key,
# keystore or properties path is read or printed.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$DistPath,
    [string]$ApkPath,
    [Parameter(Mandatory = $true)][ValidateSet('present', 'absent')][string]$Expect,
    [string]$Marker = 'risu-proxy-patch svelte@5.57.3'
)

$ErrorActionPreference = 'Stop'

function Stop-WithUsage([string]$Text) {
    [Console]::Error.WriteLine($Text)
    exit 2
}

if (-not [System.IO.Path]::IsPathRooted($DistPath)) { Stop-WithUsage 'DistPath must be an absolute path' }
if (-not [System.IO.Directory]::Exists($DistPath)) { Stop-WithUsage 'the dist folder does not exist' }
if ($ApkPath) {
    if (-not [System.IO.Path]::IsPathRooted($ApkPath)) { Stop-WithUsage 'ApkPath must be an absolute path' }
    if (-not [System.IO.File]::Exists($ApkPath)) { Stop-WithUsage 'the APK file does not exist' }
}
if ($Marker.Length -lt 8) { Stop-WithUsage 'Marker is too short to prove anything' }

$distRoot = [System.IO.Path]::GetFullPath($DistPath).TrimEnd([char]92, [char]47)
$entries = New-Object System.Collections.Generic.List[string]
$jsCount = 0
$hits = New-Object System.Collections.Generic.List[string]
try {
    $files = [System.IO.Directory]::EnumerateFiles($distRoot, '*', [System.IO.SearchOption]::AllDirectories)
    foreach ($file in $files) {
        $relative = $file.Substring($distRoot.Length).TrimStart([char]92, [char]47).Replace([char]92, [char]47)
        $bytes = [System.IO.File]::ReadAllBytes($file)
        $sha = [System.Security.Cryptography.SHA256]::Create()
        try { $fileHash = [System.BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
        $entries.Add($relative + [char]9 + $fileHash)
        $extension = [System.IO.Path]::GetExtension($file).ToLowerInvariant()
        if ($extension -ne '.js' -and $extension -ne '.mjs' -and $extension -ne '.cjs') { continue }
        $jsCount++
        if ([System.Text.Encoding]::UTF8.GetString($bytes).Contains($Marker)) { $hits.Add($relative) }
    }
}
catch {
    Stop-WithUsage ('cannot read the dist folder: ' + $_.Exception.Message)
}

if ($jsCount -eq 0) { Stop-WithUsage 'the dist folder holds no JS file; nothing was searched' }

$entries.Sort([System.StringComparer]::Ordinal)
$listing = [System.Text.Encoding]::UTF8.GetBytes(($entries -join [string][char]10) + [char]10)
$listingSha = [System.Security.Cryptography.SHA256]::Create()
try { $distHash = [System.BitConverter]::ToString($listingSha.ComputeHash($listing)).Replace('-', '').ToLowerInvariant() } finally { $listingSha.Dispose() }

$found = $hits.Count -gt 0
$ok = ($Expect -eq 'present') -eq $found
Write-Output ('dist sha256: ' + $distHash + ' (' + $entries.Count + ' files)')
if ($ApkPath) { Write-Output ('apk sha256 : ' + (Get-FileHash -LiteralPath $ApkPath -Algorithm SHA256).Hash.ToLowerInvariant()) }
Write-Output ('marker     : ' + $Marker)
Write-Output ('js files   : ' + $jsCount + ' searched, ' + $hits.Count + ' contain the marker')
foreach ($hit in $hits) { Write-Output ('  in ' + $hit) }
Write-Output ('expect     : ' + $Expect)
Write-Output ('verdict    : ' + $(if ($ok) { 'MATCH' } else { 'MISMATCH (this run is void)' }))
if ($ok) { exit 0 } else { exit 1 }
