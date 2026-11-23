#requires -Version 7.0
# Shared direct-tool guard mechanics. This is not a shell or filesystem sandbox.
$GuardRepositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$GuardRegistryRoot = Join-Path $GuardRepositoryRoot '.claude/scratch/write-scopes'
$GuardWriterRoles = @('sonnet-coder', 'haiku-editor', 'test-warrior', 'translator', 'doc-writer', 'record-clerk')
$GuardScratchRoles = @('investigator', 'deep-investigator', 'designer', 'perf-analyzer', 'adversarial-reviewer', 'opus-reviewer', 'code-searcher', 'haiku-triager', 'doc-verifier', 'senior-advisor', 'device-runner')
$GuardKnownRoles = @('code-reader', 'haiku-reviewer') + $GuardWriterRoles + $GuardScratchRoles

function Read-GuardObject([string]$Text) {
    try {
        $document = [Text.Json.JsonDocument]::Parse($Text)
        try {
            if ($document.RootElement.ValueKind -ne [Text.Json.JsonValueKind]::Object) { throw 'object required' }
            $queue = [Collections.Generic.Stack[Text.Json.JsonElement]]::new()
            $queue.Push($document.RootElement)
            while ($queue.Count) {
                $element = $queue.Pop()
                if ($element.ValueKind -eq [Text.Json.JsonValueKind]::Object) {
                    $names = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
                    foreach ($property in $element.EnumerateObject()) {
                        if (-not $names.Add($property.Name)) { throw 'duplicate JSON property' }
                        $queue.Push($property.Value)
                    }
                } elseif ($element.ValueKind -eq [Text.Json.JsonValueKind]::Array) {
                    foreach ($child in $element.EnumerateArray()) { $queue.Push($child) }
                }
            }
        }
        finally { $document.Dispose() }
        return ConvertFrom-Json -InputObject $Text -AsHashtable -Depth 20
    } catch { throw 'Invalid JSON object.' }
}
function Read-GuardStdin {
    # Hooks run without a console, where the default stdin decoding is the system ANSI code page; hook JSON is UTF-8.
    $reader = [IO.StreamReader]::new([Console]::OpenStandardInput(), [Text.UTF8Encoding]::new($false))
    try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
}
function Assert-GuardId([object]$Value) {
    if ($Value -isnot [string] -or [string]::IsNullOrWhiteSpace($Value) -or $Value.Length -gt 256 -or $Value -match '[\x00-\x1f\x7f]') {
        throw 'Missing or malformed identity.'
    }
}
function Assert-GuardRole([object]$Role) {
    Assert-GuardId $Role
    if ($Role -cnotin $GuardKnownRoles) { throw 'Unknown agent role.' }
}
function Test-GuardWithin([string]$Path, [string]$Root) {
    return $Path.Equals($Root, [StringComparison]::OrdinalIgnoreCase) -or $Path.StartsWith($Root.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)
}
function Assert-GuardNoReparse([string]$Path) {
    $cursor = $Path
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force -ErrorAction Stop
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse paths are not grantable.' }
            if ($cursor -ne $Path -and ($item.Attributes -band [IO.FileAttributes]::Directory) -eq 0) { throw 'An existing ancestor is not a directory.' }
        }
        $parent = [IO.Path]::GetDirectoryName($cursor)
        if (-not $parent -or $parent -eq $cursor) { break }
        $cursor = $parent
    }
}
function Get-GuardPath([object]$Path, [switch]$Directory) {
    if ($Path -isnot [string] -or $Path -notmatch '^[a-zA-Z]:[\\/]' -or $Path -match '[\x00-\x1f\x7f*?<>|"]') {
        throw 'Expected an ordinary absolute Windows path.'
    }
    $ordinary = $Path.Replace('/', '\')
    if ($ordinary.Substring(2).Contains(':')) { throw 'Alternate streams are not grantable.' }
    foreach ($segment in ($ordinary.Substring(3) -split '\\')) {
        if (-not $segment -or $segment -in @('.', '..') -or $segment -match '[. ]$' -or $segment -match '^(?i:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)') {
            throw 'Ambiguous, reserved or traversal path.'
        }
    }
    $canonical = [IO.Path]::GetFullPath($ordinary)
    Assert-GuardNoReparse $canonical
    if (-not $Directory -and (Test-Path -LiteralPath $canonical -PathType Container)) { throw 'Directory grants are forbidden.' }
    return $canonical
}
function Assert-GuardRepository {
    $null = Get-GuardPath $GuardRepositoryRoot -Directory
    $null = Get-GuardPath $GuardRegistryRoot -Directory
}
function Get-GuardManifestPath([string]$SessionId, [string]$AgentId, [string]$Role) {
    Assert-GuardId $SessionId; Assert-GuardId $AgentId; Assert-GuardRole $Role
    $bytes = [Text.Encoding]::UTF8.GetBytes($SessionId + [char]0 + $AgentId + [char]0 + $Role)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { $hash = [BitConverter]::ToString($algorithm.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose() }
    return Join-Path $GuardRegistryRoot ($hash + '.json')
}
function Test-GuardWorktreePointer([string]$Root) {
    # A linked worktree's .git is a file whose gitdir names an existing per-worktree directory holding commondir.
    try {
        # Git's own validation: the existing per-worktree directory sits under <common>\worktrees (so the common
        # directory exists) and its gitdir file links back to this root's .git, so a planted .git file elsewhere
        # does not qualify.
        $text = [IO.File]::ReadAllText((Join-Path $Root '.git'))
        if ($text -notmatch '(?m)^gitdir:[ \t]*(\S(?:.*\S)?)[ \t]*\r?$') { return $false }
        $gitDir = $Matches[1]
        if (-not [IO.Path]::IsPathRooted($gitDir)) { $gitDir = Join-Path $Root $gitDir }
        $gitDir = [IO.Path]::GetFullPath($gitDir).TrimEnd('\')
        if (-not (Test-Path -LiteralPath (Join-Path $gitDir 'commondir') -PathType Leaf) -or -not (Test-Path -LiteralPath (Join-Path $gitDir 'gitdir') -PathType Leaf)) { return $false }
        $common = [IO.File]::ReadAllText((Join-Path $gitDir 'commondir')).Trim()
        if (-not [IO.Path]::IsPathRooted($common)) { $common = Join-Path $gitDir $common }
        $common = [IO.Path]::GetFullPath($common).TrimEnd('\')
        if (-not [IO.Path]::GetDirectoryName($gitDir).Equals((Join-Path $common 'worktrees'), [StringComparison]::OrdinalIgnoreCase)) { return $false }
        $back = [IO.File]::ReadAllText((Join-Path $gitDir 'gitdir')).Trim()
        if (-not [IO.Path]::IsPathRooted($back)) { $back = Join-Path $gitDir $back }
        return [IO.Path]::GetFullPath($back).Equals((Join-Path $Root '.git'), [StringComparison]::OrdinalIgnoreCase)
    } catch { return $false }
}
function Get-GuardCheckout([string]$Directory) {
    # The nearest enclosing checkout of a directory, which need not exist yet; $null outside every checkout.
    $cursor = $Directory
    while ($cursor) {
        $dotGit = Join-Path $cursor '.git'
        if (Test-Path -LiteralPath $dotGit -PathType Container) { return @{ Root = $cursor; Linked = $false } }
        if (Test-Path -LiteralPath $dotGit -PathType Leaf) { return @{ Root = $cursor; Linked = (Test-GuardWorktreePointer $cursor) } }
        $parent = [IO.Path]::GetDirectoryName($cursor)
        if (-not $parent -or $parent -eq $cursor) { break }
        $cursor = $parent
    }
    return $null
}
function Get-GuardBase([string]$Path) {
    # Relative role rules apply to the checkout that owns the file: a linked worktree nested under this
    # repository root (Claude Code creates them under .claude\worktrees) has its own governance, locale and
    # evidence paths, which must not be read as this checkout's .claude directory.
    $checkout = Get-GuardCheckout ([IO.Path]::GetDirectoryName($Path))
    if ($checkout -and $checkout.Linked -and (Test-GuardWithin $checkout.Root $GuardRepositoryRoot)) { return $checkout.Root }
    return $GuardRepositoryRoot
}
function Assert-GuardNotSecret([string]$Path) {
    if ($Path -match '(?i)(?:^|\\)(?:\.git|\.aws|\.codex)(?:\\|$)' -or
        $Path -match '(?i)(?:^|\\)(?:\.env[^\\]*|keystore\.properties|[^\\]*\.(?:jks|keystore|p12|pfx|pem|key))(?:$)' -or
        $Path -match '(?i)\\src-tauri\\key\.txt$' -or $Path -match '(?i)\\server\\node\\ssl\\certificate(?:\\|$)' -or
        $Path -match '(?i)\\\.claude\\settings\.local\.json$') { throw 'Secret or repository metadata targets are forbidden.' }
    if (Test-GuardWithin $Path $GuardRegistryRoot) { throw 'Workers cannot write ownership registry targets.' }
    $base = Get-GuardBase $Path
    if (Test-GuardWithin $Path ([IO.Path]::GetFullPath((Join-Path $base '.claude/scratch/write-scopes')))) { throw 'Workers cannot write ownership registry targets.' }
    foreach ($root in @($GuardRepositoryRoot, $base)) {
        foreach ($relative in @('Agents/Evidences of Investigations/Community plugins to solve common pain points', 'Agents/Evidences of Investigations/Asset Cache/Community Mitigation_Webrowser Plugin')) {
            if (Test-GuardWithin $Path ([IO.Path]::GetFullPath((Join-Path $root $relative)))) { throw 'Protected community evidence is not grantable.' }
        }
    }
}
function Test-GuardAnyRepository([string]$Path) {
    $cursor = [IO.Path]::GetDirectoryName($Path)
    while ($cursor) {
        if (Test-Path -LiteralPath (Join-Path $cursor '.git')) { return $true }
        $parent = [IO.Path]::GetDirectoryName($cursor)
        if (-not $parent -or $parent -eq $cursor) { break }
        $cursor = $parent
    }
    return $false
}
function Assert-GuardTarget([string]$Role, [string]$Path) {
    Assert-GuardRole $Role
    Assert-GuardNotSecret $Path
    if (Test-GuardWithin $Path $GuardRepositoryRoot) {
        if ($Role -cnotin $GuardWriterRoles) { throw 'Read-only role cannot write the repository.' }
        $base = Get-GuardBase $Path
        if ($Role -in @('doc-writer', 'record-clerk') -and [IO.Path]::GetExtension($Path) -ine '.md') { throw 'Documentation writers require Markdown repository targets.' }
        if ($Role -eq 'record-clerk') {
            foreach ($relative in @('.claude', '.github', 'docs/workflow', 'Agents/mc')) {
                if (Test-GuardWithin $Path ([IO.Path]::GetFullPath((Join-Path $base $relative)))) { throw 'Record clerk cannot edit governance.' }
            }
            foreach ($relative in @('AGENTS.md', 'CLAUDE.md', 'Agents/Maintainer-Context.md', 'Agents/README.md', 'Agents/Decision-Index.md')) {
                if ($Path.Equals([IO.Path]::GetFullPath((Join-Path $base $relative)), [StringComparison]::OrdinalIgnoreCase)) { throw 'Record clerk cannot edit authoritative decisions or governance.' }
            }
        }
        # The seven non-English locales (MC-058).
        if ($Role -eq 'translator' -and ([IO.Path]::GetDirectoryName($Path) -ine (Join-Path $base 'src/lang').Replace('/', '\') -or [IO.Path]::GetFileName($Path) -inotmatch '^(ko|cn|zh-Hant|vi|de|es|ja)\.ts$')) { throw 'Translator target is outside non-English locale scope.' }
    } else {
        if ($Role -cnotin ($GuardWriterRoles + $GuardScratchRoles)) { throw 'Role has no scratch Write/Edit grant.' }
        $tempRoot = Get-GuardPath ([IO.Path]::GetFullPath($env:TEMP)) -Directory
        if (-not (Test-GuardWithin $Path $tempRoot) -or (Test-GuardAnyRepository $Path)) { throw 'External scratch must be under temporary storage and outside every detected repository.' }
    }
}
function Get-GuardSessionWorktree([object]$Cwd) {
    # The linked worktree holding the hook payload's cwd, or $null (main checkout, no checkout, malformed cwd).
    if ($Cwd -isnot [string]) { return $null }
    try { $directory = Get-GuardPath $Cwd -Directory } catch { return $null }
    $checkout = Get-GuardCheckout $directory
    if (-not $checkout -or -not $checkout.Linked -or -not (Test-GuardWithin $checkout.Root $GuardRepositoryRoot)) { return $null }
    return $checkout.Root
}
# test-warrior is left out because it also runs as a review route, and reviewers get no repository writes.
$GuardWorktreeRoles = @('sonnet-coder', 'haiku-editor', 'translator', 'doc-writer', 'record-clerk')
# Never covered by the automatic grant: the guard and hook configuration, workflow policy and state,
# governance and agent instructions, and the maintainer-protected legal and branding paths. An exact grant
# can still name them when the task is authorized.
$GuardWorktreeExcludedTrees = @('.claude', '.github', '.gemini', '.antigravity', 'docs/workflow', 'docs/branding', 'Agents/mc')
$GuardWorktreeExcludedFiles = @('AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'Agents/Workflow-State.json', 'Agents/Maintainer-Context.md', 'Agents/README.md', 'Agents/Decision-Index.md', 'docs/Terms-of-Services.md', 'docs/Privacy-Policy.md', 'src/lib/Others/Legal.svelte')
function Test-GuardWorktreeGrant([string]$Role, [object]$Cwd, [string]$Path) {
    # MC-2750: an implementing writer role may write ordinary files inside the linked worktree its session's
    # payload cwd points at, without an exact grant. Nothing is stored, so the grant follows the cwd and ends
    # with the session or the worktree. Callers run Assert-GuardTarget first, so role, secret and
    # protected-path bounds still apply; the main checkout keeps exact grants.
    if ($Role -cnotin $GuardWorktreeRoles) { return $false }
    $worktree = Get-GuardSessionWorktree $Cwd
    if (-not $worktree) { return $false }
    $owner = Get-GuardCheckout ([IO.Path]::GetDirectoryName($Path))
    if (-not ($owner -and $owner.Linked -and $owner.Root.Equals($worktree, [StringComparison]::OrdinalIgnoreCase))) { return $false }
    foreach ($relative in $GuardWorktreeExcludedTrees) { if (Test-GuardWithin $Path ([IO.Path]::GetFullPath((Join-Path $worktree $relative)))) { return $false } }
    foreach ($relative in $GuardWorktreeExcludedFiles) { if ($Path.Equals([IO.Path]::GetFullPath((Join-Path $worktree $relative)), [StringComparison]::OrdinalIgnoreCase)) { return $false } }
    # Agent instruction files load at any depth, and a nested .claude directory carries agents, skills or settings.
    $relativePath = $Path.Substring($worktree.TrimEnd('\').Length).TrimStart('\')
    if ([IO.Path]::GetFileName($Path) -match '(?i)^(?:CLAUDE|CLAUDE\.local|AGENTS|GEMINI)\.md$' -or $relativePath -match '(?i)(?:^|\\)\.claude(?:\\|$)' -or $relativePath -ieq '.mcp.json') { return $false }
    return $true
}
function Read-GuardManifest([string]$SessionId, [string]$AgentId, [string]$Role) {
    $path = Get-GuardManifestPath $SessionId $AgentId $Role
    $null = Get-GuardPath $path
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw 'Exact instance registration is required.' }
    $manifest = Read-GuardObject ([IO.File]::ReadAllText($path))
    $keys = @('version', 'sessionId', 'agentId', 'role', 'repositoryRoot', 'files')
    foreach ($key in $manifest.Keys) { if ($key -cnotin $keys) { throw 'Unsupported manifest field.' } }
    Assert-GuardId $manifest.sessionId; Assert-GuardId $manifest.agentId; Assert-GuardRole $manifest.role
    if ($manifest.Count -ne $keys.Count -or ($manifest.version -isnot [int] -and $manifest.version -isnot [long]) -or $manifest.version -ne 1 -or $manifest.sessionId -cne $SessionId -or $manifest.agentId -cne $AgentId -or $manifest.role -cne $Role) { throw 'Manifest identity mismatch.' }
    $root = Get-GuardPath $manifest.repositoryRoot -Directory
    if (-not $root.Equals($GuardRepositoryRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Manifest belongs to another checkout.' }
    if ($manifest.files -isnot [array] -or $manifest.files.Count -eq 0) { throw 'Manifest requires exact file targets.' }
    $targets = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($file in $manifest.files) {
        $target = Get-GuardPath $file
        Assert-GuardTarget $Role $target
        if (-not $targets.Add($target)) { throw 'Duplicate manifest target.' }
    }
    return ,$targets
}
