#requires -Version 7.0
$ErrorActionPreference = 'Stop'
try {
    $payload = [Console]::In.ReadToEnd()
    $root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
    $payload | & node (Join-Path $PSScriptRoot 'workflow-control.mjs') hook --root $root
    exit $LASTEXITCODE
} catch {
    [Console]::Error.WriteLine('Workflow hook failed closed; inspect policy/state and runtime before retrying.')
    exit 2
}
