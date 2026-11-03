# Registered dispatches only. Routing, retry accounting and paid fallback belong to the controller.
param(
    [Parameter(Mandatory)][string]$DispatchFile,
    [ValidateSet('scout', 'implement', 'review')][string]$Mode,
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$arguments = @((Join-Path $PSScriptRoot 'worker.mjs'), '--dispatch-file', $DispatchFile)
if ($Mode) { $arguments += @('--mode', $Mode) }
if ($DryRun) { $arguments += @('--dry-run', 'true') }
& node @arguments
exit $LASTEXITCODE
