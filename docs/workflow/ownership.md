# Write ownership and parallel work

The orchestrator assigns exact write ownership before dispatch and maintains one integration owner for the resulting snapshot. No agent acquires write permission merely by discovering a related defect. [Review gates](gates.md), [record closeout](records.md) and protected-work rules remain applicable.

## Checkout boundary

Only **one application-code writer per checkout** may be active at a time. Coders and test writers count together; tests are application-code writes for this rule. Sequential handoff between coder and test-warrior is allowed. Read-only surveys/reviews/helpers may run concurrently if their evidence names the snapshot observed.

Parallel writers for distinct application items use separate worktrees with explicit starting revisions and a named integration owner. State the intended branch/ref/commit and verify the new checkout actually starts there; a creation tool's default branch may differ from the active branch. Existing dirty changes do not silently follow a new checkout. The integration owner resolves overlap, checks the integrated diff and obtains applicable verification on the integrated snapshot. This policy does not automatically create a worktree or authorize a merge/commit/push.

Documentation writers may share a checkout only with exact nonoverlapping named paths. Governance/current-state records get a named owner; two writers do not append to the same log independently. A requested boundary expansion goes to the orchestrator before mutation. Protect the maintainer's launch/manifest changes and untracked handoff evidence; no blanket staging, cleanup or deletion.

## Direct Write/Edit guard contract

For guarded workflow sessions, use an ownership manifest naming the exact allowed repository files and their owning task, with explicit orchestrator grants for any expansion. Reviewers have no repository Write/Edit grants. A manifest is a narrow authorization record, not an invitation to infer parent-folder permission or modify other owned files.

Resolve requested paths to absolute paths, compare them against the workspace and exact allowed targets, and fail closed when the manifest/grant is absent, malformed or ambiguous. Preserve unowned dirty work even inside a generally allowed directory. Scratch experiments belong outside the repository and must follow the role's allowed scratch scope.

A direct-tool hook is a guard on the tool calls it actually intercepts. It is not a filesystem sandbox and does not guarantee that shell commands, scripts, external tools or alternate mutation channels cannot write. No blanket command filter or claimed shell enforcement is introduced. The orchestrator still enforces doctrine, named boundaries and independent diff verification.

## Claude configuration and registration

[Project settings](../../.claude/settings.json) configure `SubagentStart` identity context and `PreToolUse` matching `Write|Edit`, using the PowerShell shell and quoted `$env:CLAUDE_PROJECT_DIR` script paths. [guard-write.ps1](../../.claude/scripts/guard-write.ps1) checks direct writes; [register-write-scope.ps1](../../.claude/scripts/register-write-scope.ps1) registers, replaces or revokes grants. This implementation targets ordinary Windows drive paths and requires PowerShell 7; other hosts need adapted or local hook configuration before delegated writes. See [Anthropic's hook reference](https://code.claude.com/docs/en/hooks) for the platform protocol and [implementation record](improvements-2026-10-08.md) for actual verification.

A grant contains `version`, `sessionId`, `agentId`, `role`, `repositoryRoot` and an array of exact absolute `files`. Its identity-specific filename is generated under ignored `.claude/scratch/write-scopes/`. No role-wide grants, globs or directory grants are inferred. Registration replaces the whole file list; an amendment supplies the complete revised list.

Read-only work and draft-only returns proceed normally. Before the first actual Write/Edit, a worker lacking a grant returns its observed session/agent/role identity once. The parent registers the already-authorized exact files, then resumes the same instance. This is an orchestrator handoff, not a new human approval question or a repeated denied-tool loop. In PowerShell 7, invoke the helper directly so file arrays remain arrays:

```powershell
& ./.claude/scripts/register-write-scope.ps1 -SessionId 'observed-session' -AgentId 'observed-agent' -Role 'doc-writer' -Files @((Join-Path (Get-Location) 'docs/example.md'))
& ./.claude/scripts/register-write-scope.ps1 -SessionId 'observed-session' -AgentId 'observed-agent' -Role 'doc-writer' -Revoke
```

Only ordinary main-thread calls with both agent identity keys genuinely absent retain normal authorization without a worker grant. A named `--agent` main session uses its actual role and the `main` agent-ID sentinel. Unknown or malformed worker identity cannot use that exemption. Read-only roles cannot receive repository-write grants; permitted external verification scratch needs exact grants and validated temporary paths. The parent revokes completed assignments during closeout.

The guard uses its script's checkout root. Native worktree entry may leave `CLAUDE_PROJECT_DIR` pointing at the original session root, so it does not automatically switch ownership registries. Parallel application work needs a separately launched Claude session rooted in each explicitly prepared worktree, using that checkout's hooks and grants. A foreign-checkout write is denied instead of silently inheriting the original grant.

When the script runs, denial and internal validation errors exit 2 with a concise stderr reason; success exits 0 without granting extra permission. Hook startup failures, missing scripts, timeouts or disabled hooks can proceed through normal permissions. These limits and shell/alternate-channel exclusions prevent treating the hook as universal enforcement. Synthetic tests of the scripts do not prove native hook loading; that remains a separate observation.
