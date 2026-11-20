# Write ownership and parallel work

The orchestrator assigns exact write ownership before dispatch and maintains one integration owner for the resulting snapshot. No agent acquires write permission merely by discovering a related defect. [Review gates](gates.md), [record closeout](records.md) and protected-work rules remain applicable.

## Checkout boundary

Only **one application-code writer per checkout** may be active at a time. Coders and test writers count together; tests are application-code writes for this rule. Sequential handoff between coder and test-warrior is allowed. Read-only surveys/reviews/helpers may run concurrently if their evidence names the snapshot observed.

Parallel writers for distinct application items use separate worktrees with explicit starting revisions and a named integration owner. State the intended branch/ref/commit and verify the new checkout actually starts there; a creation tool's default branch may differ from the active branch. Existing dirty changes do not silently follow a new checkout. The integration owner resolves overlap, checks the integrated diff and obtains applicable verification on the integrated snapshot. Each ticket gets its own session, worktree and `claude/<ticket>` branch without another permission question; numeric caps live only in `.claude/workflow-policy.json`. Commit, push, PR open and merge follow the [approval matrix](gates.md#approval-matrix-mc-2744) (MC-2744); this grants no destructive cleanup or new product scope.

Documentation writers may share a checkout only with exact nonoverlapping named paths. Governance/current-state records get a named owner; two writers do not append to the same log independently. A requested boundary expansion goes to the orchestrator before mutation. Protect the maintainer's launch/manifest changes and untracked handoff evidence; no blanket staging, cleanup or deletion.

## Independent tracks and worktree procedure

Scheduling class is separate from execution mode: workClass code|records|device|documents, mode scout|implement|review. Each ticket session is one code writer in its own worktree; records drafters and device runners proceed beside them, within the caps in `.claude/workflow-policy.json` and any later maintainer decision. Read-only work and disjoint documents do not consume code-writer slots. Required device results and administrative closeout block affected acceptance/release/COMPLETE only, not the next unrelated ticket.

At start/resume, dispatch completion and parked waits, lane A fills idle lanes with ready tickets. If the next ticket is not ready, name its actual dependency or continue bounded discovery/planning for an already-authorized next item. Do not invent scope to fill a slot. Keep coherent batch gates and serial stage writers inside each worktree.

### Ticket sessions and branches

Each ticket runs in its own Claude Code session with its own Git worktree (the app normally creates it under `.claude/worktrees/<name>`) and a `claude/<ticket>` branch cut from a verified `origin/main`. Record the base commit before the first write and check that the new checkout starts there; dirty or untracked files in the main checkout never follow automatically. The session commits, pushes its branch and opens one PR per ticket under the [approval matrix](gates.md#approval-matrix-mc-2744); lane A merges. A dependent stage may stack its branch on the previous stage's branch and say so in the PR body. Never copy an entire checkout over main or overwrite another owner's changes. See [Git's worktree reference](https://git-scm.com/docs/git-worktree).

Within a session, a subagent's writes stay in that session's worktree: a harness hook refuses writes to a second worktree.
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

**Grants for worktree sessions (MC-2750).** The hooks read the registries of the checkout named by `CLAUDE_PROJECT_DIR`, which may be the main checkout `C:\Projects\RisuAI` even when the session works in a worktree (it was on 2026-11-20); check `$env:CLAUDE_PROJECT_DIR` first. So a worktree session registers through the main checkout's tools: write grants with `C:\Projects\RisuAI\.claude\scripts\register-write-scope.ps1`, naming the worktree's absolute file paths, and dispatches with `node C:\Projects\RisuAI\.claude\scripts\workflow-control.mjs register` run from the main checkout, with `"repoRoot"` in the dispatch JSON set to the worktree. Observed by sessions on 2026-11-20 (not part of MC-2750): a grant registered only through the worktree's own copy of the scripts was refused; do not start a separately rooted session to work around it. Revoke through the same main-checkout script after the agent has handed back. Automatic, self-revoking per-worktree grants are the tooling ticket #384 (MC-2750). A foreign-checkout write is denied instead of silently inheriting the original grant.

When the script runs, denial and internal validation errors exit 2 with a concise stderr reason; success exits 0 without granting extra permission. The active cutover settings request blocking failure behavior for governed hooks where the installed runtime supports it. Verify native smoke results in the cutover record; disabled hooks, alternate channels and unsupported runtime behavior cannot be treated as enforcement. These limits and shell/alternate-channel exclusions prevent treating the hook as universal enforcement. Hook commands must propagate the script's exit code (`; exit $LASTEXITCODE`), because PowerShell `-Command` otherwise reports exit 1, which Claude Code treats as non-blocking. Synthetic tests of the scripts do not prove native hook loading; that remains a separate observation.

Trade-off (MC-785). For code-searcher, haiku-triager, doc-verifier and senior-advisor the absence of a Write tool was a second barrier to repository writes. With Write granted for report files, the direct-tool hook is the only barrier on that channel. Older hook settings fell through on startup failure/timeout. The cutover settings request blocking failure behavior, with native execution evidence recorded separately. Native nested helpers require a recorded fallback under subscription-first routing. The validator cross-checks that a profile's Write/Edit tool matches a guard writer or scratch role and the reverse. A TEMP report file is also writable by every scratch role: briefs forbid Write or Edit of files the agent did not create, the Orchestrator records verdict-file size and hash, and the guard does not enforce this.

## Worktree cleanup (MC-1918, MC-1960)

A session removes its own worktree and branch once they are clean and merged into `origin/main`: remove the `node_modules` junction with a non-recursive `rmdir` first, then plain `git worktree remove` (no `--force`), then `git branch -d` (not `-D`), and report it to lane A. Lane B may also discard build-made line-ending churn in its own finished APK build worktrees before removing them (MC-1960); any content change still asks. Dirty or unmerged worktrees, and anything that is not the session's own, need the maintainer's approval. Builds rewrite `src-tauri/Cargo.toml` to LF with no content change; leave that churn unstaged.

## Shared environment

Derived standing practice from past incidents, not numbered decisions, except where an MC is cited.

The worktrees share the main checkout's `node_modules` through a junction. Rules:

- Never run `pnpm install` through a junction, and never run pnpm in a scratch copy that lacks `pnpm-workspace.yaml`: both have rewritten the shared install's state.
- The shared `pnpm install` in the main checkout is run by lane A only, when no session is running tests or builds (MC-2713 item 4). A session that hits a stale-module failure reports it to lane A instead of installing.
- Before its first run, a new worktree checks that its junction resolves to the main checkout's `node_modules` and that its `pnpm-lock.yaml` matches main's; a lockfile change waits for lane A's install.
- `pnpm check` needs `NODE_OPTIONS=--max-old-space-size=8192`, as CI sets it; the default heap runs out of memory.
- Never remove a shared `node_modules` junction recursively.

## Shell and guard pitfalls

These are derived standing brief rules (not numbered decisions), kept because each has caused damage:

- The write guard covers the Write and Edit tools only. Shell writes bypass it, so briefs forbid temporary repository edits through any shell (including "edit, run, restore" mutant tricks).
- Mutants run in scratch copies or through in-memory module substitution, never by editing repository files.
- No index operations (`git add -N`, `git reset`, `git stash`) in a shared checkout; read line endings with a non-index method such as `git ls-files --eol` or a byte count.
- No PowerShell double-quoted strings for code edits: a backtick sequence such as `` `r `` turns into a control character. Use the Edit tool or single-quoted here-strings.
- PowerShell helper functions get a Verb-Noun name: a helper called `Rd` ran the built-in alias for Remove-Item and deleted repository files.
- Writer and scratch roles write scratch under `%TEMP%` outside every repository; scratch in a job folder inside the checkout is refused.
- Claude Code blocks a subagent's Write of files named `REPORT*`, `SUMMARY*` or `FINDINGS*`; briefs name report files otherwise (for example `result.md`).
- General-purpose agents are refused even scratch writes by the guard; use a guard-known role.
- Kill only processes you started, by PID, never by image name.
