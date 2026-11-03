# Write ownership and parallel work

The orchestrator assigns exact write ownership before dispatch and maintains one integration owner for the resulting snapshot. No agent acquires write permission merely by discovering a related defect. [Review gates](gates.md), [record closeout](records.md) and protected-work rules remain applicable.

## Checkout boundary

Only **one application-code writer per checkout** may be active at a time. Coders and test writers count together; tests are application-code writes for this rule. Sequential handoff between coder and test-warrior is allowed. Read-only surveys/reviews/helpers may run concurrently if their evidence names the snapshot observed.

Parallel writers for distinct application items use separate worktrees with explicit starting revisions and a named integration owner. State the intended branch/ref/commit and verify the new checkout actually starts there; a creation tool's default branch may differ from the active branch. Existing dirty changes do not silently follow a new checkout. The integration owner resolves overlap, checks the integrated diff and obtains applicable verification on the integrated snapshot. The [2026-11-03 amendment](2026-11-03-parallel-tracks.md) authorizes the parent to prepare up to two worktrees for ready already-authorized disjoint code TODOs without another permission question. This grants no merge/commit/push, destructive cleanup or new product scope.

Documentation writers may share a checkout only with exact nonoverlapping named paths. Governance/current-state records get a named owner; two writers do not append to the same log independently. A requested boundary expansion goes to the orchestrator before mutation. Protect the maintainer's launch/manifest changes and untracked handoff evidence; no blanket staging, cleanup or deletion.

## Independent tracks and worktree procedure

Scheduling class is separate from execution mode: workClass code|records|device|documents, mode scout|implement|review. Two actual code writers, one records drafter and one device runner may proceed together. Read-only work and disjoint documents do not consume code-writer slots. Required device results and administrative closeout block affected acceptance/release/COMPLETE only, not the next unrelated ticket.

At start/resume, dispatch completion and parked waits, fill free code tracks with ready authorized tasks. If a second task is not ready, name its actual dependency or continue bounded discovery/planning for an already-authorized next item. Do not invent scope to fill a slot. Keep coherent batch gates and serial stage writers inside each worktree.

Record the base and integration owner, choose a unique unused destination, then prepare and verify the worktree:

```powershell
$taskBase = (git -C C:\Projects\RisuAI rev-parse HEAD).Trim()
$taskWorktree = Join-Path $env:TEMP ('risu-code-track-' + [guid]::NewGuid().ToString('N'))
git -C C:\Projects\RisuAI worktree add --detach $taskWorktree $taskBase
git -C $taskWorktree rev-parse HEAD
```

Verify the last output equals the recorded base; record the path and exact planned writes. Repeat for the second disjoint track. An optional branch follows the host branch convention (codex/ when Codex creates it). Dirty/untracked main changes are separately named inputs and do not automatically follow. See [Git's worktree reference](https://git-scm.com/docs/git-worktree).

Each worktree is its code track's source/integration checkout. Normal external workers still run in sanitized exports from it, through the central parent/controller, without another Claude parent. One owner integrates reviewed deltas serially using named patches with checked preimages or registered journal provenance. Do not commit merely to enable a merge, copy an entire checkout over main or overwrite another owner's changes.

Declare canonical resources: device:<serial>, individual tcp:<port>, checkout:<absolute-path>, build:<absolute-path>. Do not use arbitrary port-range spellings as proof of nonoverlap; expand the actual ports into individual claims. Normalize filesystem case/trailing separators. Separate output/build directories and ports. The guard checks declared claims, not undisclosed OS activity.

A device build reserves its mutable source checkout/output. Device-class registration uses devicePhase build plus checkout:<source-root>; a default/run phase includes artifact:{sha256,sourceRevision} (64-hex hash) and its device resource. Those are declared provenance, not proof of actual bytes; the parent verifies the artifact/configuration. Once its immutable APK is ready, record its hash, source revision and relevant build/configuration provenance; finish/release that build phase, then run the device against the pinned artifact while code advances. Shared source builds, colliding devices/ports/output remain real conflicts. Serialize CPU/memory-sensitive measurement against competing heavy builds/full suites where load invalidates results, rather than blocking all unrelated coding.

## Direct Write/Edit guard contract

For guarded workflow sessions, use an ownership manifest naming the exact allowed repository files and their owning task, with explicit orchestrator grants for any expansion. Reviewers have no repository Write/Edit grants. A manifest is a narrow authorization record, not an invitation to infer parent-folder permission or modify other owned files.

Resolve requested paths to absolute paths, compare them against the workspace and exact allowed targets, and fail closed when the manifest/grant is absent, malformed or ambiguous. Preserve unowned dirty work even inside a generally allowed directory. Scratch experiments belong outside the repository and must follow the role's allowed scratch scope.

A direct-tool hook is a guard on the tool calls it actually intercepts. It is not a filesystem sandbox and does not guarantee that shell commands, scripts, external tools or alternate mutation channels cannot write. No blanket command filter or claimed shell enforcement is introduced. The orchestrator still enforces doctrine, named boundaries and independent diff verification. The [subscription-first controller](subscription-first.md) additionally checks registered routes, ownership and dispatch identity; it is not an OS/shell sandbox. External workers use sanitized isolated exports and host-verified deltas, not native checkout grants.

## Claude configuration and registration

[Project settings](../../.claude/settings.json) configure `SubagentStart` identity context and `PreToolUse` matching `Write|Edit`, using the PowerShell shell and quoted `$env:CLAUDE_PROJECT_DIR` script paths. [guard-write.ps1](../../.claude/scripts/guard-write.ps1) checks direct writes; [register-write-scope.ps1](../../.claude/scripts/register-write-scope.ps1) registers, replaces or revokes grants. This implementation targets ordinary Windows drive paths and requires PowerShell 7; other hosts need adapted or local hook configuration before delegated writes. See [Anthropic's hook reference](https://code.claude.com/docs/en/hooks) for the platform protocol and [implementation record](improvements-2026-10-08.md) for actual verification.

A grant contains `version`, `sessionId`, `agentId`, `role`, `repositoryRoot` and an array of exact absolute `files`. Its identity-specific filename is generated under ignored `.claude/scratch/write-scopes/`. No role-wide grants, globs or directory grants are inferred. Registration replaces the whole file list; an amendment supplies the complete revised list.

Read-only work and draft-only returns proceed normally. Before the first actual Write/Edit, a worker lacking a grant returns its observed session/agent/role identity once. The parent registers the already-authorized exact files, then resumes the same instance. This is an orchestrator handoff, not a new human approval question or a repeated denied-tool loop. In PowerShell 7, invoke the helper directly so file arrays remain arrays:

```powershell
& ./.claude/scripts/register-write-scope.ps1 -SessionId 'observed-session' -AgentId 'observed-agent' -Role 'doc-writer' -Files @((Join-Path (Get-Location) 'docs/example.md'))
& ./.claude/scripts/register-write-scope.ps1 -SessionId 'observed-session' -AgentId 'observed-agent' -Role 'doc-writer' -Revoke
```

Only ordinary main-thread calls with both agent identity keys genuinely absent retain normal authorization without a worker grant. A named `--agent` main session uses its actual role and the `main` agent-ID sentinel. Unknown or malformed worker identity cannot use that exemption. Read-only roles cannot receive repository-write grants; repository writes still need exact grants. Writer and scratch roles may write external targets under TEMP outside every repository without a manifest; read-only roles may not. doc-writer and record-clerk repository targets must be Markdown (record-clerk additionally excludes governance), while their external TEMP scratch may use any extension. Scratch roles are investigator, deep-investigator, designer, perf-analyzer, adversarial-reviewer, opus-reviewer, code-searcher, haiku-triager, doc-verifier and senior-advisor (MC-785); they never receive repository grants. code-reader remains read-only. The parent revokes completed assignments during closeout.

The guard uses its script's checkout root. Native worktree entry may leave `CLAUDE_PROJECT_DIR` pointing at the original session root, so it does not automatically switch ownership registries. Only native fallback that directly writes a worktree needs a separately rooted session with that checkout's current hooks and grants. Normal external code tracks use central-parent dispatch into sanitized exports; preparing worktrees does not require extra Claude parents or relays. A foreign-checkout write is denied instead of silently inheriting the original grant.

When the script runs, denial and internal validation errors exit 2 with a concise stderr reason; success exits 0 without granting extra permission. The active cutover settings request blocking failure behavior for governed hooks where the installed runtime supports it. Verify native smoke results in the cutover record; disabled hooks, alternate channels and unsupported runtime behavior cannot be treated as enforcement. These limits and shell/alternate-channel exclusions prevent treating the hook as universal enforcement. Hook commands must propagate the script's exit code (`; exit $LASTEXITCODE`), because PowerShell `-Command` otherwise reports exit 1, which Claude Code treats as non-blocking. Synthetic tests of the scripts do not prove native hook loading; that remains a separate observation.

Trade-off (MC-785). For code-searcher, haiku-triager, doc-verifier and senior-advisor the absence of a Write tool was a second barrier to repository writes. With Write granted for report files, the direct-tool hook is the only barrier on that channel. Older hook settings fell through on startup failure/timeout. The cutover settings request blocking failure behavior, with native execution evidence recorded separately. Native nested helpers require a recorded fallback under subscription-first routing. The validator cross-checks that a profile's Write/Edit tool matches a guard writer or scratch role and the reverse. A TEMP report file is also writable by every scratch role: briefs forbid Write or Edit of files the agent did not create, the Orchestrator records verdict-file size and hash, and the guard does not enforce this.
