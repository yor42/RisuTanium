#requires -Version 7.0
param(
    [string]$Root = (Join-Path $PSScriptRoot '../..'),
    [string]$LogDir = ''
)

# Runs the full application checks in order and never hides a failure: every step runs,
# each keeps its complete output in its own log, and the exit code is 1 if any step failed.
$ErrorActionPreference = 'Continue'
$taskRoot = [IO.Path]::GetFullPath($Root)
if (-not $LogDir) { $LogDir = Join-Path ([IO.Path]::GetTempPath()) ('risu-checks/' + (Get-Date -Format 'yyyyMMdd-HHmmss')) }
$null = New-Item -ItemType Directory -Force -Path $LogDir
$LogDir = (Resolve-Path -LiteralPath $LogDir).Path

$steps = @(
    @{ Name = 'test'; Exe = 'pnpm'; Args = @('test') },
    @{ Name = 'check'; Exe = 'pnpm'; Args = @('check') },
    @{ Name = 'build'; Exe = 'pnpm'; Args = @('build') },
    @{ Name = 'release-dist'; Exe = 'node'; Args = @('util/checkReleaseDist.mjs', 'dist') }
)
$failPattern = 'FAIL|Error|✗|×'
$results = [Collections.Generic.List[object]]::new()
Write-Output "Root: $taskRoot"
Write-Output "Logs: $LogDir"

foreach ($step in $steps) {
    $command = ($step.Exe + ' ' + ($step.Args -join ' '))
    $log = Join-Path $LogDir ($step.Name + '.log')
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $code = 0
    Push-Location -LiteralPath $taskRoot
    try {
        $global:LASTEXITCODE = 0
        & $step.Exe @($step.Args) 2>&1 | Out-File -LiteralPath $log -Encoding utf8
        $code = $LASTEXITCODE
        if ($null -eq $code) { $code = 1 }
    } catch {
        $_.Exception.Message | Out-File -LiteralPath $log -Encoding utf8 -Append
        $code = 127
    } finally { Pop-Location }
    $watch.Stop()
    $seconds = [Math]::Round($watch.Elapsed.TotalSeconds, 1)
    $results.Add([pscustomobject]@{ Step = $step.Name; ExitCode = $code; Seconds = $seconds; Log = $log })
    Write-Output ''
    Write-Output "== $command"
    Write-Output "exit code: $code; duration: ${seconds}s; log: $log"
    if ($code -ne 0) {
        $lines = @(if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log } else { @() })
        Write-Output '-- last 40 lines'
        $lines | Select-Object -Last 40 | ForEach-Object { Write-Output $_ }
        Write-Output "-- lines matching $failPattern"
        $lines | Where-Object { $_ -match $failPattern } | ForEach-Object { Write-Output $_ }
    }
}

Write-Output ''
Write-Output 'Summary'
$results | ForEach-Object { '{0,-14} {1,-6} {2,8}s  {3}' -f $_.Step, $(if ($_.ExitCode -eq 0) { 'PASS' } else { 'FAIL' }), $_.Seconds, $_.Log } | Write-Output
$failed = @($results | Where-Object { $_.ExitCode -ne 0 })
if ($failed.Count) {
    Write-Output "$($failed.Count) of $($results.Count) steps failed."
    exit 1
}
Write-Output "All $($results.Count) steps passed."
exit 0
