#requires -Version 7.0
$ErrorActionPreference = 'Stop'
try {
    . (Join-Path $PSScriptRoot 'write-guard-common.ps1')
    Assert-GuardRepository
    $payload = Read-GuardObject (Read-GuardStdin)
    if ($payload.hook_event_name -isnot [string] -or $payload.hook_event_name -cne 'SubagentStart') { throw 'Unexpected event.' }
    Assert-GuardId $payload.session_id; Assert-GuardId $payload.agent_id; Assert-GuardRole $payload.agent_type
    $context = 'Instance identity: session={0}; agent={1}; role={2}; checkout={3}. Proceed with authorized reads, analysis and returned drafts.' -f $payload.session_id, $payload.agent_id, $payload.agent_type, $GuardRepositoryRoot
    if ($payload.agent_type -cin ($GuardWriterRoles + $GuardScratchRoles)) {
        $context += ' Scratch files under %TEMP% outside any repository (reports, notes, measurement output) need no registration: write them directly with Write/Edit and hand back the path, not the full text. Claude Code refuses a subagent Write of any .md whose file name starts with report, summary, findings or analysis (any case), so name it result.md or <id>-result.md even if the brief says report.md; if a Write is still refused with "return findings as text", put the full text in the hand-back instead. Only before a needed direct Write/Edit to a repository file, report this identity once and wait for the parent to register already-authorized exact files, then resume this SAME instance. Never self-register, claim pending scopes or retry denied writes in a loop. Repository/scratch role bounds remain in force.'
    } else { $context += ' This role has no Write/Edit authorization; no registration pause is needed for read-only work.' }
    @{ hookSpecificOutput = @{ hookEventName = 'SubagentStart'; additionalContext = $context } } | ConvertTo-Json -Depth 3 -Compress
} catch {
    [Console]::Error.WriteLine('Subagent identity context unavailable; direct writes still require explicit registration.')
    # SubagentStart context is informative; it does not claim to block spawning.
    exit 0
}
