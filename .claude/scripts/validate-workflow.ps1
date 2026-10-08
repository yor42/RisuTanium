#requires -Version 7.0
param(
    [string]$Root = (Join-Path $PSScriptRoot '../..'),
    [switch]$SkipArchive,
    [switch]$SkipGitIgnore
)

$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath($Root)
$problems = [Collections.Generic.List[string]]::new()
function Problem([string]$Message) { $problems.Add($Message) }
function Read-Frontmatter([string]$Path, [string[]]$Allowed) {
    $text = [IO.File]::ReadAllText($Path)
    $match = [regex]::Match($text, '\A---\r?\n(.*?)\r?\n---(?:\r?\n|$)', 'Singleline')
    if (-not $match.Success) { Problem "Missing frontmatter: $Path"; return @{} }
    $fields = @{}
    # This deliberately accepts only our scalar and inline-list subset, not arbitrary YAML.
    foreach ($line in ($match.Groups[1].Value -split '\r?\n')) {
        if ($line -notmatch '^([a-z][a-z-]*): (.+)$') {
            Problem "Unsupported frontmatter subset in ${Path}: $line"; continue
        }
        $key = $Matches[1]; $value = $Matches[2]
        if ($fields.ContainsKey($key)) { Problem "Duplicate key $key in $Path" }
        if ($key -notin $Allowed) { Problem "Unsupported key $key in $Path" }
        $fields[$key] = $value
    }
    return $fields
}
function Inline-List([string]$Value, [string]$Where) {
    if ($Value -notmatch '^\[([a-zA-Z][a-zA-Z-]*(?:, [a-zA-Z][a-zA-Z-]*)*)?\]$') {
        Problem "Expected simple inline list at $Where"; return @()
    }
    if (-not $Matches[1]) { return @() }
    return @($Matches[1] -split ', ')
}
function Read-RulePaths([string]$Path) {
    $text = [IO.File]::ReadAllText($Path)
    # Only a paths key and quoted block-list entries are supported here, not full YAML.
    $match = [regex]::Match($text, '\A---\r?\npaths:\r?\n((?:  - "[^"\r\n]+"\r?\n)+)---(?:\r?\n|$)')
    if (-not $match.Success) { Problem "Unsupported rule frontmatter; expected only paths with a quoted block list: $Path"; return @() }
    $paths = @([regex]::Matches($match.Groups[1].Value, '  - "([^"\r\n]+)"') | ForEach-Object { $_.Groups[1].Value })
    foreach ($glob in $paths) {
        if ($glob -match '(^/|\\|:|[?\[\]{}]|(?:^|/)\.\.?(/|$))') { Problem "Unsupported relative rule glob in ${Path}: $glob" }
    }
    if (@($paths | Select-Object -Unique).Count -ne $paths.Count) { Problem "Duplicate rule path: $Path" }
    return $paths
}
function Test-RuleGlob([string]$Glob, [string]$Path) {
    $pattern = '^'
    for ($i = 0; $i -lt $Glob.Length; $i++) {
        if ($Glob[$i] -eq '*') {
            if ($i + 1 -lt $Glob.Length -and $Glob[$i + 1] -eq '*') {
                $i++
                if ($i + 1 -lt $Glob.Length -and $Glob[$i + 1] -eq '/') { $pattern += '(?:.*/)?'; $i++ }
                else { $pattern += '.*' }
            } else { $pattern += '[^/]*' }
        } else { $pattern += [regex]::Escape([string]$Glob[$i]) }
    }
    return [regex]::IsMatch($Path, $pattern + '$', [Text.RegularExpressions.RegexOptions]::CultureInvariant)
}

$agentDir = Join-Path $taskRoot '.claude/agents'
$skillDir = Join-Path $taskRoot '.claude/skills'
$ruleDir = Join-Path $taskRoot '.claude/rules'
$agents = @{}; $skills = @{}; $rules = @{}
foreach ($file in (Get-ChildItem -LiteralPath $agentDir -Filter '*.md')) {
    $fields = Read-Frontmatter $file.FullName @('name', 'description', 'model', 'tools', 'skills', 'permissionMode')
    $name = $fields['name']
    if (-not $name -or $name -cne $file.BaseName) { Problem "Agent name/file mismatch: $($file.Name)" }
    if ($name -and $agents.ContainsKey($name)) { Problem "Duplicate agent name: $name" }
    if (-not $fields['description']) { Problem "Missing description: $($file.Name)" }
    if ($fields['model'] -notin @('haiku', 'sonnet', 'opus', 'fable')) { Problem "Unexpected model alias: $($file.Name)" }
    foreach ($tool in (Inline-List $fields['tools'] "$($file.Name) tools")) {
        if ($tool -notin @('Read', 'Edit', 'Write', 'Grep', 'Glob', 'PowerShell', 'Bash', 'Agent', 'LSP')) {
            Problem "Unexpected tool $tool in $($file.Name)"
        }
    }
    if ($fields.ContainsKey('permissionMode') -and $fields['permissionMode'] -ne 'default') {
        Problem "Non-default permission mode: $($file.Name)"
    }
    if ($name) { $agents[$name] = @{ Fields = $fields; Path = $file.FullName } }
}
foreach ($folder in (Get-ChildItem -LiteralPath $skillDir -Directory)) {
    $path = Join-Path $folder.FullName 'SKILL.md'
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { Problem "Missing SKILL.md: $($folder.Name)"; continue }
    $fields = Read-Frontmatter $path @('name', 'description', 'user-invocable', 'context', 'agent')
    $name = $fields['name']
    if (-not $name -or $name -cne $folder.Name) { Problem "Skill name/folder mismatch: $($folder.Name)" }
    if ($name -and $skills.ContainsKey($name)) { Problem "Duplicate skill name: $name" }
    if (-not $fields['description']) { Problem "Missing skill description: $($folder.Name)" }
    if ($fields.ContainsKey('user-invocable') -and $fields['user-invocable'] -notin @('true', 'false')) {
        Problem "Invalid user-invocable boolean: $($folder.Name)"
    }
    if ($fields.ContainsKey('context') -and $fields['context'] -ne 'fork') { Problem "Unsupported skill context: $($folder.Name)" }
    if ($fields.ContainsKey('agent') -and (-not $agents.ContainsKey($fields['agent']) -or $fields['context'] -ne 'fork')) {
        Problem "Missing fork agent/context: $($folder.Name)"
    }
    if ($name) { $skills[$name] = @{ Fields = $fields; Path = $path } }
}
if (Test-Path -LiteralPath $ruleDir -PathType Container) {
    foreach ($file in (Get-ChildItem -LiteralPath $ruleDir -Filter '*.md')) {
        $paths = @(Read-RulePaths $file.FullName)
        $rules[$file.BaseName] = @{ Path = $file.FullName; Globs = $paths }
        foreach ($glob in $paths) {
            $trackedMatches = & git -C $taskRoot ls-files -- $glob
            if ($LASTEXITCODE -ne 0 -or -not @($trackedMatches | Where-Object { Test-RuleGlob $glob $_ }).Count) { Problem "Rule path has no tracked source target: $($file.Name) $glob" }
        }
    }
} else { Problem 'Missing .claude/rules.' }
foreach ($agent in $agents.Values) {
    foreach ($skill in (Inline-List $agent.Fields['skills'] "$($agent.Path) skills")) {
        if (-not $skills.ContainsKey($skill)) { Problem "Unresolved preloaded skill $skill in $($agent.Path)" }
    }
}

try {
    $configText = [IO.File]::ReadAllText((Join-Path $taskRoot '.claude/settings.json'))
    $json = [Text.Json.JsonDocument]::Parse($configText)
    $json.Dispose()
    $config = $configText | ConvertFrom-Json -AsHashtable
    if ($config.env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH -cne '2') { Problem 'Project nesting depth must be string 2.' }
    foreach ($event in @('PreToolUse', 'SubagentStart')) {
        $groups = $config.hooks[$event]
        if ($groups -isnot [array] -or $groups.Count -ne 1) { Problem "Expected one project hook group: $event"; continue }
        if ($event -eq 'PreToolUse' -and $groups[0].matcher -cne 'Write|Edit') { Problem 'Write/Edit matcher is missing or broadened.' }
        $commands = $groups[0].hooks
        if ($commands -isnot [array] -or $commands.Count -ne 1) { Problem "Expected one command hook: $event"; continue }
        $hook = $commands[0]
        if ($hook.type -cne 'command' -or $hook.shell -cne 'powershell' -or $hook.timeout -le 0) { Problem "Invalid PowerShell command hook: $event" }
        if ($hook.command -notmatch '^& "\$env:CLAUDE_PROJECT_DIR\\\.claude\\scripts\\([a-z-]+\.ps1)"$') { Problem "Hook must use the quoted project script path: $event" }
        elseif (-not (Test-Path -LiteralPath (Join-Path $taskRoot ('.claude/scripts/' + $Matches[1])) -PathType Leaf)) { Problem "Missing hook script: $event" }
    }
} catch { Problem "Invalid settings JSON: $($_.Exception.Message)" }
try { & (Join-Path $PSScriptRoot 'check-language-intelligence.ps1') -Root $taskRoot -MetadataOnly }
catch { Problem "Invalid language-intelligence metadata: $($_.Exception.Message)" }
$scriptDir = Join-Path $taskRoot '.claude/scripts'
foreach ($script in (Get-ChildItem -LiteralPath $scriptDir -Filter '*.ps1')) {
    $text = [IO.File]::ReadAllText($script.FullName)
    if ($text -notmatch '\A#requires -Version 7\.0(?:\r?\n)') { Problem "Missing PowerShell 7 requirement: $($script.Name)" }
    $tokens = $null; $errors = $null
    $null = [Management.Automation.Language.Parser]::ParseFile($script.FullName, [ref]$tokens, [ref]$errors)
    if ($errors.Count) { Problem "PowerShell syntax errors: $($script.Name)" }
    foreach ($reference in [regex]::Matches($text, '\b[a-z][a-z-]*\.ps1\b')) {
        if (-not (Test-Path -LiteralPath (Join-Path $scriptDir $reference.Value) -PathType Leaf)) { Problem "Unresolved script helper in $($script.Name): $($reference.Value)" }
    }
}
foreach ($rootName in @('AGENTS.md', 'CLAUDE.md')) {
    $path = Join-Path $taskRoot $rootName
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { Problem "Missing $rootName"; continue }
    if ([IO.File]::ReadAllLines($path).Length -ge 200) { Problem "$rootName must remain below 200 lines." }
}

# Check local link targets only in active workflow surfaces, never recursive evidence/history.
$documents = [Collections.Generic.List[string]]::new()
foreach ($name in @('AGENTS.md', 'CLAUDE.md', 'Agents/README.md', 'Agents/Live-State.md', 'Agents/Carry-Forward.md', 'Agents/Decision-Index.md')) {
    $path = Join-Path $taskRoot $name
    if (Test-Path -LiteralPath $path -PathType Leaf) { $documents.Add($path) } else { Problem "Missing active document: $name" }
}
$workflowDir = Join-Path $taskRoot 'docs/workflow'
if (Test-Path -LiteralPath $workflowDir -PathType Container) {
    foreach ($file in (Get-ChildItem -LiteralPath $workflowDir -Filter '*.md')) { $documents.Add($file.FullName) }
} else { Problem 'Missing docs/workflow.' }
foreach ($agent in $agents.Values) { $documents.Add($agent.Path) }
foreach ($skill in $skills.Values) { $documents.Add($skill.Path) }
foreach ($rule in $rules.Values) { $documents.Add($rule.Path) }
foreach ($path in $documents) {
    $text = [IO.File]::ReadAllText($path)
    foreach ($link in [regex]::Matches($text, '\]\(([^)]+)\)')) {
        $target = $link.Groups[1].Value.Trim()
        if ($target -match '^[a-zA-Z][a-zA-Z0-9+.-]*:' -or $target.StartsWith('#')) { continue }
        $target = ($target -split '#', 2)[0].Trim('<', '>')
        if (-not $target) { continue }
        $target = [Uri]::UnescapeDataString($target)
        $resolved = if ($target.StartsWith('/')) { Join-Path $taskRoot $target.TrimStart('/') } else { Join-Path (Split-Path $path) $target }
        if (-not (Test-Path -LiteralPath $resolved)) { Problem "Broken local link in ${path}: $target" }
    }
}
try { & (Join-Path $PSScriptRoot 'update-decision-index.ps1') -Root $taskRoot -Check }
catch { Problem $_.Exception.Message }

if (-not $SkipGitIgnore) {
    $ignored = @(
        '.claude/worktrees/workflow-sentinel.txt', '.claude/settings.local.json',
        '.claude/agent-memory-local/workflow-sentinel.txt', '.claude/scratch/workflow-sentinel.txt', '.claude/scratch/write-scopes/workflow-sentinel.json',
        'Agents/Evidences of Investigations/Community plugins to solve common pain points/workflow-sentinel.txt',
        'Agents/Evidences of Investigations/Asset Cache/Community Mitigation_Webrowser Plugin/workflow-sentinel.txt'
    )
    $visible = @('.claude/settings.json', '.claude/scripts/validate-workflow.ps1', '.claude/scripts/update-decision-index.ps1',
        'Agents/Evidences of Investigations/workflow-sentinel.txt')
    $visible += @($agents.Values | ForEach-Object { [IO.Path]::GetRelativePath($taskRoot, $_.Path).Replace('\', '/') })
    $visible += @($skills.Values | ForEach-Object { [IO.Path]::GetRelativePath($taskRoot, $_.Path).Replace('\', '/') })
    $visible += @($rules.Values | ForEach-Object { [IO.Path]::GetRelativePath($taskRoot, $_.Path).Replace('\', '/') })
    $visible += @('.claude/lsp-marketplace/.claude-plugin/marketplace.json', '.claude/lsp-marketplace/plugins/svelte-lsp/.claude-plugin/plugin.json')
    foreach ($path in $ignored + $visible) {
        $null = & git -C $taskRoot check-ignore --no-index --quiet -- $path
        $status = $LASTEXITCODE
        if ($status -notin @(0, 1)) { Problem "git check-ignore failed: $path" }
        elseif (($path -in $ignored) -ne ($status -eq 0)) { Problem "Wrong ignore coverage: $path" }
    }
}
$docker = [IO.File]::ReadAllLines((Join-Path $taskRoot '.dockerignore')) | Where-Object { $_ -and -not $_.StartsWith('#') }
foreach ($path in @('.claude', 'Agents', 'docs')) {
    if ($path -notin $docker) { Problem "Docker context no longer excludes $path" }
}

if (-not $SkipArchive) {
    $archiveDir = Join-Path $taskRoot 'Agents/Archive/2026-10-08'
    $manifestPath = Join-Path $archiveDir 'README.md'
    $archiveHashes = @{}
    if (Test-Path -LiteralPath $manifestPath -PathType Leaf) {
        foreach ($row in [regex]::Matches([IO.File]::ReadAllText($manifestPath), '\| \[[^\]]+\]\(([^)]+)\) \| [^\r\n]+ \| `([A-Fa-f0-9]{64})` \|')) {
            $archiveHashes[$row.Groups[1].Value] = $row.Groups[2].Value
        }
    } else { Problem 'Missing archive byte-hash manifest.' }
    $archiveMap = @{ 'AGENTS.md' = 'AGENTS.snapshot.md'; 'Agents/Live-State.md' = 'Live-State.md'; 'Agents/Phase2-Handoff.md' = 'Phase2-Handoff.md' }
    $originalCommit = 'a5a3095de32d988c01fb89656f377043db874b05'
    foreach ($entry in $archiveMap.GetEnumerator()) {
        $snapshot = Join-Path $archiveDir $entry.Value
        if (-not (Test-Path -LiteralPath $snapshot -PathType Leaf)) { Problem "Missing archive snapshot: $snapshot"; continue }
        if (-not $archiveHashes.ContainsKey($entry.Value) -or (Get-FileHash -LiteralPath $snapshot -Algorithm SHA256).Hash -cne $archiveHashes[$entry.Value]) {
            Problem "Archive byte hash differs from original-byte manifest: $($entry.Value)"
        }
        $original = & git -C $taskRoot show "${originalCommit}:$($entry.Key)"
        if ($LASTEXITCODE -ne 0) { Problem "Cannot read archive baseline: $($entry.Key)"; continue }
        # Git stores normalized blobs; the snapshot preserves original working-tree bytes.
        $headText = ($original -join "`n").TrimEnd("`r", "`n")
        $snapshotText = [IO.File]::ReadAllText($snapshot).Replace("`r`n", "`n").TrimEnd("`n")
        if ($headText -cne $snapshotText) { Problem "Archive differs from normalized pinned original: $($entry.Key)" }
    }
}
if ($problems.Count) { throw ($problems -join "`n") }
Write-Output "Workflow checks passed: $($agents.Count) agents, $($skills.Count) skills, $($rules.Count) path rules, $($documents.Count) active documents."
Write-Output 'Scope: project frontmatter/rule-glob subset, references, index, ignore coverage and normalized archive baseline. Native Claude loading/validation owns full YAML/runtime semantics; links check target files, not heading anchors. Rule metadata/fixtures do not prove native runtime loading.'
