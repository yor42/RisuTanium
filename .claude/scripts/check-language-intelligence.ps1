#requires -Version 7.0
param(
    [switch]$MetadataOnly,
    [string]$Root = (Join-Path $PSScriptRoot '../..')
)
$ErrorActionPreference = 'Stop'
# Reuse strict JSON-object parsing only; this script neither grants writes nor changes ownership.
. (Join-Path $PSScriptRoot 'write-guard-common.ps1')
$taskRoot = [IO.Path]::GetFullPath($Root)
function Test-LspString([object]$Value, [string]$Expected) { return $Value -is [string] -and $Value -ceq $Expected }
$marketplaceRoot = Join-Path $taskRoot '.claude/lsp-marketplace'
$marketplace = Read-GuardObject ([IO.File]::ReadAllText((Join-Path $marketplaceRoot '.claude-plugin/marketplace.json')))
if (-not (Test-LspString $marketplace.name 'risutanium-lsp') -or $marketplace.owner -isnot [Collections.IDictionary] -or -not (Test-LspString $marketplace.owner.name 'RisuTanium maintainers') -or $marketplace.plugins -isnot [array] -or $marketplace.plugins.Count -ne 1) { throw 'Unsupported local LSP marketplace metadata.' }
$entry = $marketplace.plugins[0]
if (-not (Test-LspString $entry.name 'svelte-lsp') -or -not (Test-LspString $entry.source './plugins/svelte-lsp')) { throw 'Svelte marketplace source must remain the contained local plugin path.' }
$pluginRoot = [IO.Path]::GetFullPath((Join-Path $marketplaceRoot $entry.source))
if (-not $pluginRoot.StartsWith($marketplaceRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'LSP plugin source escapes the local marketplace.' }
$plugin = Read-GuardObject ([IO.File]::ReadAllText((Join-Path $pluginRoot '.claude-plugin/plugin.json')))
if (-not (Test-LspString $plugin.name 'svelte-lsp') -or -not (Test-LspString $plugin.version '1.0.0') -or $plugin.lspServers -isnot [Collections.IDictionary] -or $plugin.lspServers.Count -ne 1 -or $plugin.lspServers.Keys -cnotcontains 'svelte') { throw 'Unsupported Svelte plugin metadata.' }
$server = $plugin.lspServers.svelte
if ($server -isnot [Collections.IDictionary] -or -not (Test-LspString $server.command 'svelteserver') -or $server.args -isnot [array] -or $server.args.Count -ne 1 -or -not (Test-LspString $server.args[0] '--stdio') -or $server.extensionToLanguage -isnot [Collections.IDictionary] -or $server.extensionToLanguage.Count -ne 1 -or -not (Test-LspString $server.extensionToLanguage['.svelte'] 'svelte') -or $server.Contains('requestTimeout')) { throw 'Svelte LSP command or extension map is invalid for the supported configuration.' }
$settings = Read-GuardObject ([IO.File]::ReadAllText((Join-Path $taskRoot '.claude/settings.json')))
$requiredPlugins = @('typescript-lsp@claude-plugins-official', 'rust-analyzer-lsp@claude-plugins-official', 'svelte-lsp@risutanium-lsp')
foreach ($id in $requiredPlugins) {
    if ($settings.enabledPlugins[$id] -isnot [bool] -or -not $settings.enabledPlugins[$id]) { throw "Required project plugin is not explicitly enabled: $id" }
}
Write-Output 'LSP metadata is valid. This does not prove installation, binary startup or native Claude language-intelligence use.'
if ($MetadataOnly) { exit 0 }

function Invoke-LanguageCheck([string]$Executable, [string[]]$Arguments) {
    # A PowerShell wrapper executes .cmd shims correctly; paths/arguments are quoted as literals.
    $command = '& ' + "'" + $Executable.Replace("'", "''") + "'"
    foreach ($argument in $Arguments) { $command += ' ' + "'" + $argument.Replace("'", "''") + "'" }
    $command += '; exit $LASTEXITCODE'
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = (Get-Command pwsh -CommandType Application | Select-Object -First 1).Source
    $start.WorkingDirectory = $taskRoot
    $start.UseShellExecute = $false; $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
    foreach ($argument in @('-NoProfile', '-EncodedCommand', [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command)))) { $start.ArgumentList.Add($argument) }
    $process = [Diagnostics.Process]::Start($start)
    $stdout = $process.StandardOutput.ReadToEndAsync(); $stderr = $process.StandardError.ReadToEndAsync()
    try {
        if (-not $process.WaitForExit(10000)) {
            $process.Kill($true); $process.WaitForExit()
            return @{ ExitCode = -1; Stdout = ''; Stderr = 'Version/inventory command timed out.' }
        }
        if (-not [Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]@($stdout, $stderr), 2000)) {
            return @{ ExitCode = -1; Stdout = ''; Stderr = 'Command output streams did not finish within the limit.' }
        }
        return @{ ExitCode = $process.ExitCode; Stdout = $stdout.GetAwaiter().GetResult(); Stderr = $stderr.GetAwaiter().GetResult() }
    } finally { $process.Dispose() }
}
$missing = [Collections.Generic.List[string]]::new()
foreach ($name in @('tsc', 'typescript-language-server', 'svelteserver', 'rust-analyzer')) {
    $command = @(Get-Command -Name ($name + '.cmd'), ($name + '.exe'), $name -CommandType Application -ErrorAction SilentlyContinue)[0]
    if (-not $command) { $missing.Add("Missing binary: $name"); continue }
    $result = Invoke-LanguageCheck $command.Source @('--version')
    if ($result.ExitCode -ne 0 -or -not $result.Stdout.Trim()) { $missing.Add("Version check failed/unverified: $name (exit $($result.ExitCode))"); continue }
    Write-Output ("Binary version observed: {0} — {1}" -f $name, $result.Stdout.Trim())
}
$claude = @(Get-Command claude -CommandType Application -ErrorAction SilentlyContinue)[0]
if (-not $claude) { $missing.Add('Claude plugin inventory unavailable.') }
else {
    Push-Location -LiteralPath $taskRoot
    try { $inventory = Invoke-LanguageCheck $claude.Source @('plugin', 'list', '--json') }
    finally { Pop-Location }
    if ($inventory.ExitCode -ne 0) { $missing.Add('Claude plugin inventory command failed/unverified.') }
    else {
        try { $installed = $inventory.Stdout | ConvertFrom-Json -AsHashtable }
        catch { throw 'Claude plugin inventory was not valid JSON.' }
        foreach ($id in $requiredPlugins) {
            if (-not @($installed | Where-Object { $_.id -ceq $id -and $_.scope -ceq 'project' -and $_.enabled -eq $true -and $_.projectEnabled -eq $true }).Count) { $missing.Add("Installed/enabled project plugin not observed: $id") }
        }
    }
}
if ($missing.Count) { throw ($missing -join "`n") }
Write-Output 'Binary version and project-inventory prerequisites observed. Native LSP initialize/definition/reference behavior still requires separate execution evidence.'
