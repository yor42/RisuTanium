#requires -Version 7.0
# Shared direct-tool guard mechanics. This is not a shell or filesystem sandbox.
$GuardRepositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$GuardRegistryRoot = Join-Path $GuardRepositoryRoot '.claude/scratch/write-scopes'
$GuardWriterRoles = @('sonnet-coder', 'haiku-editor', 'test-warrior', 'translator', 'doc-writer', 'record-clerk')
$GuardScratchRoles = @('investigator', 'deep-investigator', 'perf-analyzer', 'adversarial-reviewer', 'opus-reviewer')
$GuardKnownRoles = @('code-searcher', 'haiku-triager', 'code-reader', 'doc-verifier', 'senior-advisor', 'haiku-reviewer') + $GuardWriterRoles + $GuardScratchRoles

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
function Assert-GuardNotSecret([string]$Path) {
    if ($Path -match '(?i)(?:^|\\)(?:\.git|\.aws|\.codex)(?:\\|$)' -or
        $Path -match '(?i)(?:^|\\)(?:\.env[^\\]*|keystore\.properties|[^\\]*\.(?:jks|keystore|p12|pfx|pem|key))(?:$)' -or
        $Path -match '(?i)\\src-tauri\\key\.txt$' -or $Path -match '(?i)\\server\\node\\ssl\\certificate(?:\\|$)' -or
        $Path -match '(?i)\\\.claude\\settings\.local\.json$') { throw 'Secret or repository metadata targets are forbidden.' }
    if (Test-GuardWithin $Path $GuardRegistryRoot) { throw 'Workers cannot write ownership registry targets.' }
    foreach ($relative in @('Agents/Evidences of Investigations/Community plugins to solve common pain points', 'Agents/Evidences of Investigations/Asset Cache/Community Mitigation_Webrowser Plugin')) {
        if (Test-GuardWithin $Path ([IO.Path]::GetFullPath((Join-Path $GuardRepositoryRoot $relative)))) { throw 'Protected community evidence is not grantable.' }
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
    if ($Role -in @('doc-writer', 'record-clerk') -and [IO.Path]::GetExtension($Path) -ine '.md') { throw 'Documentation writers require Markdown targets.' }
    if (Test-GuardWithin $Path $GuardRepositoryRoot) {
        if ($Role -cnotin $GuardWriterRoles) { throw 'Read-only role cannot write the repository.' }
        if ($Role -eq 'record-clerk') {
            foreach ($relative in @('.claude', '.github', 'docs/workflow')) {
                if (Test-GuardWithin $Path ([IO.Path]::GetFullPath((Join-Path $GuardRepositoryRoot $relative)))) { throw 'Record clerk cannot edit governance.' }
            }
            foreach ($relative in @('AGENTS.md', 'CLAUDE.md', 'Agents/Maintainer-Context.md', 'Agents/README.md', 'Agents/Decision-Index.md')) {
                if ($Path.Equals([IO.Path]::GetFullPath((Join-Path $GuardRepositoryRoot $relative)), [StringComparison]::OrdinalIgnoreCase)) { throw 'Record clerk cannot edit authoritative decisions or governance.' }
            }
        }
        if ($Role -eq 'translator' -and ([IO.Path]::GetDirectoryName($Path) -ine (Join-Path $GuardRepositoryRoot 'src/lang').Replace('/', '\') -or [IO.Path]::GetFileName($Path) -inotmatch '^(ko|cn|zh-Hant|vi|de|es)\.ts$')) { throw 'Translator target is outside non-English locale scope.' }
    } else {
        if ($Role -cnotin ($GuardWriterRoles + $GuardScratchRoles)) { throw 'Role has no scratch Write/Edit grant.' }
        $tempRoot = Get-GuardPath ([IO.Path]::GetFullPath($env:TEMP)) -Directory
        if (-not (Test-GuardWithin $Path $tempRoot) -or (Test-GuardAnyRepository $Path)) { throw 'External scratch must be under temporary storage and outside every detected repository.' }
    }
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
