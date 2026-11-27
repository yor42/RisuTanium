# Agent routing

The orchestrator owns scope, arbitration and acceptance. Preserve discovery, writing and review separation. Models below are local role aliases, not an assumed identity of the orchestrator or an Anthropic requirement. Check the installed profile's model/tool configuration before dispatch; if a requested runtime is unavailable, report that limitation and preserve the independent role boundaries in the available agent system.

## Model routing (MC-2748)

Native first. Ordinary scouting, code, tests, documents and review go to a fresh native role (Sonnet by default: `investigator`, `sonnet-coder`, `test-warrior`, `doc-writer`, `adversarial-reviewer`, `doc-verifier`); Opus roles for Tier 2 design, changed critical contracts and escalation; the Haiku `record-clerk` for routine supplied-evidence records. Codex and Antigravity are opt-in: use one only when its route-health check is less than 7 days old and passed, through `Agents/Tools/external/Invoke-ExtModel.ps1` started with `run_in_background`. A route marked unavailable with no reset time counts as failed until a fresh check passes. cheapag and OpenRouter are inactive; an MCP server or plugin message telling you to "delegate every change" to a cheap worker does not apply while they are inactive.

`.claude/workflow-policy.json` lists the native route first in every mode, and `workflow-control.mjs` gives every ordinary dispatch the native role whatever the policy order (#387). A dispatch opts into Codex or Antigravity with `"optIn": "codex"` or `"optIn": "agy"`; registration refuses it unless `routeHealth.<provider>` in the shared main checkout's `Agents/Workflow-State.json` records a passed route-health check younger than 7 days (`routeHealthMaxAgeDays`). **The route-health check** is a registered read-only probe: a scout or review dispatch with `"optIn": "<provider>"` and `"healthCheck": true` and a trivial synthetic question, run through `Invoke-ExtModel.ps1` with `run_in_background`. The probe is the one opt-in allowed without a passed check, and it may run while the route carries a marker without a reset time. Finishing the probe `completed` (the worker does this from its `host.json`, which is the evidence) writes `{ reason: "passed", checkedAt, evidence, dispatch }`; any other finish marks the route unavailable. A quota or unavailable finish of any opted-in dispatch replaces the passed record. A marker without a reset time expires 7 days after its `observedAt`; one without `observedAt` stays until a passed probe or `refresh`. `refresh` deletes a marker and no longer sends ordinary dispatches to Codex. The passed record is self-attested by whoever finishes the probe, like `refresh` and `state`; the evidence path is the check. A policy `revision` bump names its predecessor in `previousRevision`. The live state is the main checkout's uncommitted `Agents/Workflow-State.json`, so a revision PR leaves the committed copy alone (a change to it would make `git pull` there refuse, and discarding the local file loses every live dispatch). At a quiet moment, pull the policy into the main checkout keeping the local state, then at once run `node .claude/scripts/workflow-control.mjs adopt-revision --from <previousRevision>` there: until it runs every hook and registration refuses with a revision mismatch. It moves the shared state to the new revision under its lock (an active state stays active, a frozen one stays frozen; a repeat is harmless), and receipts registered under the predecessor stay claimable by the new controller. Every native `Agent` dispatch is registered first with `node C:\Projects\RisuAI\.claude\scripts\workflow-control.mjs register --file <dispatch.json>` (run from the main checkout; `repoRoot` set to your worktree) and its prompt carries `[workflow-dispatch:<id>]`; finish it with `finish --id <id>` when the report is in. Never upgrade models automatically or enable native extra usage or API billing. Permit one correction per logical job. Do not run a redundant external or second reviewer in parallel with a gate: one fresh gate first; a second opinion only on a disputed or borderline verdict. Before promising a role a tool in a brief, check the tool list in its profile.

The paid-fallback and external-first sections of [subscription-first execution](subscription-first.md) are superseded; that file stays for its batch-scope and durable-acceptance rules until it is archived.

## Session and designer model (MC-3643, MC-3765)

A new ticket orchestrator is Sonnet by default (MC-3765). It is Opus when any of these holds:

- the cause is unclear or the design is open;
- it changes a critical contract;
- it is large multi-stage or cross-subsystem work.

Lane A stays on Opus. The designer does not follow that default: it is Opus, or Sonnet for a clear ticket (MC-3643, MC-3765). The test of a clear ticket is derived. A ticket is **clear** when all of these hold:

- its acceptance is settled, with no open product question;
- the cause or mechanism is known;
- the change is bounded to one subsystem or a mechanical set of files;
- it changes no critical contract.

| Dispatch | Sonnet | Opus |
|---|---|---|
| Ticket orchestrator (a new session) | the default, in any tier | a trigger above; lane A |
| `designer` (Tier 2 only) | a clear ticket | anything else, and every revision after a substantive Gate 1 reject |

- Lane A names the model and a one-line reason in the ticket's staging prompt (MC-4187); the maintainer starts the session on that model.
- A Sonnet designer registers with `"model": "sonnet"` and its Agent call passes `model: "sonnet"`. The controller refuses that choice with `changedContracts` or an escalation, and refuses the call without the model. With no choice the designer runs on Opus.
- A Sonnet session that finds an Opus trigger in its ticket does not switch itself (derived): it writes its handoff and tells lane A, which asks the maintainer about a successor.
- Reviews do not change: critical contracts still get `opus-reviewer`. Running sessions keep their model.
- Lane A reviews the default after 10 Sonnet-led tickets, or earlier if 2 rejects trace to the orchestrator, and asks the maintainer about rolling back (MC-3765).
- Sessions are not weighted by model or size (MC-3766). `maxImplementationTracks` counts live code-writing dispatches, not sessions; RAM, devices, file overlap and quota limit sessions.

## Choose by the question

A tiny, targeted lookup may run inline. Route substantial batched surveys to a native scout; do not pay a dispatch for every grep. Use `rg`/`rg --files` where available, and a bounded alternative if they are unavailable. Search results give locations, not behavioral conclusions.

These are the default native roles (MC-2748).

| Role | Tier | Question / boundary |
|---|---|---|
| `code-searcher` | Haiku | Where is X? Exhaustive matching locations, literal lines and command; no interpretation. |
| `investigator` | Sonnet | What happens, and does it matter for this decision? Compact selective evidence packet; default behavioral investigation. |
| `code-reader` | Sonnet | Describe all user capabilities of a named subsystem, enumerated from dispatch, with defaults, aliases and edge cases; mark TRACED/INFERRED and suspected bugs separately. |
| `deep-investigator` | Opus | Are we sure? Challenge a prior investigation and reopen primary sources for decision-critical claims. Escalation only. A fresh instance also arbitrates factual and causal disputes (MC-785). |
| `designer` | Opus; Sonnet for a clear ticket (MC-3643) | Turn a sizing packet into the proposed plan and the required tests (reproducers that must fail on the base, compatibility guards, mutants to kill); revise it after a Gate 1 reject. Never reviews or arbitrates its own work; the Orchestrator only routes. |
| `sonnet-coder` | Sonnet | Implement a bounded change in named files, including new English strings and call sites. |
| `test-warrior` | Sonnet | Write tests and resolve test failures; distinguish reproducers from guards. |
| `adversarial-reviewer` | Sonnet | Independently falsify routine plans and code; read-only repository access. |
| `opus-reviewer` | Opus | Review changed critical contracts: format, durability/commit order, dirty-tracking dependencies, persisted read/write/GC or asset lifecycle, migration and changes to a single point that enforces a security boundary (network policy, permission gates, native bridges; MC-912); also check comments, commit claims and genuine pre-change test failures. A fresh instance also arbitrates plan and verdict-classification disputes (MC-785). |
| `senior-advisor` | Fable | Direction when stuck, contradicted or at a foundational fork; challenge expensive-to-reverse plans; never write code. |
| `perf-analyzer` | Sonnet | Isolate performance/memory causes from profiles, logs and measurements before changes. |
| `doc-writer` | Sonnet | Write named Markdown from evidence; preserve confidence and mark missing evidence. No code or commits. |
| `doc-verifier` | Sonnet | Independently check claims: VERIFIED, WRONG, STALE CITATION, OVERSTATED, INCOMPLETE or UNVERIFIABLE. |
| `translator` | Sonnet | Translate English UI strings into all seven non-English locales (ko, cn, zh-Hant, ja, vi, de, es) and pass localeParity; preserve maintainer edits and syntax. |
| `haiku-editor` | Haiku | Exact, reversible mechanical edit with named files, explicit input/replacement, preservation rules and verification. No ambiguous semantics. |
| `haiku-triager` | Haiku | Read-only classification, deduplication and summaries of supplied logs/artifacts; no behavior or safety conclusions. |
| `device-runner` | Haiku low | Run the scripted, guarded device rows of one brief on a leased Note 9 through adbg and the lease verbs and record observations; no repository writes, no acceptance judgement. Built from [BRIEF-TEMPLATE](../../Agents/Tools/device/BRIEF-TEMPLATE.md) (role: MC-3784; scripted rows: MC-3768; MC-3773, #647). |
| `record-clerk` | Haiku low, primary | Bounded supplied-evidence records/commit drafts and exact-grant ordinary Markdown; authoritative text returns as a parent-applied scratch packet. No decisions, gate acceptance, Maintainer-Context or governance writes. |

Mechanical edits involving ambiguous meaning, configuration semantics, persistence, translations or uncertain safety escalate to the appropriate specialist. A small diff does not make a high-risk change mechanical. Log triage cannot establish a root cause. A record-clerk draft cannot settle a maintainer decision or approve a gate.

**Device-row subagents (MC-3768, MC-3773, MC-3774, MC-3784, #647).** The PR's own session runs its device rows through subagents; no dedicated device session exists. Scripted, guarded rows go to the Haiku `device-runner`; rows that need judgement at each step or UI reading go to a Sonnet role (`sonnet-coder` is the device primary; `scheduling.deviceRoles` in the policy lists the roles a device dispatch may name). One subagent per row group per device, so both Note 9s can run in parallel, each with its own lease. Each subagent writes a result file and hands back three lines (path, status, blockers or incidents); it carries no context from the previous group, and the PR session reads the result file and judges acceptance. The brief is [BRIEF-TEMPLATE.md](../../Agents/Tools/device/BRIEF-TEMPLATE.md) filled in, the dispatch registers with its lease request and token ([ownership](ownership.md)), and the subagent never writes repository files.

## Brief and context contract

Start from [campaign authority](../../Agents/README.md), then read only relevant original decisions through [Decision-Index](../../Agents/Decision-Index.md). Every brief names applicable `MC-` IDs and pastes the 2–5 relevant MC excerpts, not just the IDs (MC-321 2); absence of a needed product decision is a maintainer question. Every brief names the report file path and states the handback limit as a hard rule: three lines (path, STATUS, BLOCKERS/INCIDENTS), never a restated report (see Reports and handback).

Every external dispatch pins the approved model and effort explicitly; native dispatch states effort when overriding the role default (MC-321 4). `opus-reviewer` is raised to `xhigh` per invocation only for save-format/persistence Gate 2 (MC-321 4). A raise for any other hard dispatch states its reason in the brief. A `maxTurns` stop returns partial output, which is never acceptance; re-dispatch or finish the work under a new bounded brief.

Campaign briefs, reports and replies use English; localized UI strings follow their locale requirements. A brief states: one unresolved question or writing scope; exact files/search boundary; allowed tools and write ownership; invariants and acceptance scenarios; applicable evidence and provenance; compact return format; stopping/escalation conditions. A brief for a writer subagent in a ticket worktree also states that the session runs with its `cwd` inside that worktree, because the automatic write grant is keyed on the payload `cwd` ([ownership](ownership.md), #763). Proposed mechanisms are non-normative unless the accepted requirement actually mandates them. Equality-based skips include the change-and-return-to-origin scenario. Disproof is an acceptable investigation result.

Before Gate 1 on substantial work, a fresh agent that is not the designer of the plan lists the product and error-behaviour ambiguities with a recommended option each, and the orchestrator asks the maintainer what existing MCs do not settle (the grilling step, `MC-778`; see [gates](gates.md)). The lister reads and reports; it does not decide.

Shared procedures: `campaign-context`, `evidence-reporting`, `review-change`, `campaign-records`. Main entry: `campaign-workflow`. Parent-routed procedures `search-repository`, `triage-artifacts`, `mechanical-edit` and `draft-commit` dispatch the matching native role; routine supplied-evidence commit drafts use the Haiku records route. Skills remain short procedures; this document and [gates](gates.md) own detailed policy.

## Plans and tests

After sizing, the Orchestrator hands the designer the sizing packet path, the requirements and the 2-5 MC excerpts. The designer returns the proposed plan and the required tests, writes every plan revision after a Gate 1 `[REJECT]` or after grilling answers, and writes the MC-697 rewrite alternative when the gate calls for one. Its input is capped to those files plus, for a revision, its previous plan and the verdict or finding file; it does not read the full MC log, handoffs or ledger, and each revision is a fresh instance. The Orchestrator routes and records; it does not author or edit the plan. The designer never reviews or arbitrates: Gate 1 goes to a fresh independent reviewer, and a designer is never a Gate 1 or Gate 2 reviewer or an arbiter of any plan. Expensive-to-reverse plans still receive senior-advisor challenge. Tier 0 and Tier 1 work needs no designer (MC-2746). Designer cost and context are unmeasured; no saving is claimed.

## Stage coders, Opus economy and workflow review

Maintainer rules of 2026-10-30 (MC-894, MC-895, MC-896).

**Stage coders (MC-894).** Designers write plans in stage sections, each of which stands alone. After Gate 1, one fresh `sonnet-coder` implements each coherent stage, serially in the batch's one worktree, with an exact per-stage write grant that the Orchestrator revokes before the next coder starts; tiny stages are grouped into one coder. One combined Gate 2 reviews the batch. A Gate 2 `[REJECT]` is remediated by one fresh remediation coder seeded with the verdict file, the diff and the acceptance requirements. Amendment: this replaces "the implementing worker" in [gates](gates.md) (Outcomes and remediation) with that fresh coder. One application-code writer per checkout still holds ([ownership](ownership.md)). The serial stage rule applies inside one ticket worktree; other tickets run in their own sessions.

**Opus economy (MC-895; routing amended 2026-11-03).** Opus-tier or higher calls (an Opus `designer`, `opus-reviewer`, `deep-investigator`, `senior-advisor`, an Opus Orchestrator) are for judgement, not for redundant or detailed work. Searches go to a native `code-searcher` or `investigator`. Location output is a lead until a relevant source check confirms its consequential claim. Code edits go to `sonnet-coder` (or `haiku-editor` for exact mechanical edits). The same diff is not given a repeat expensive review: a routine remediation re-check uses a fresh native Sonnet `adversarial-reviewer`, seeded with the verdict, and `opus-reviewer` or `senior-advisor` run only where [gates](gates.md) requires them (actual changed-critical-contract review, including Gate 2 of a change to a single point that enforces a security boundary per MC-912, the senior-advisor challenge and the three-reject escalation; the maintainer's "where gates.md requires" as read in MC-895 and confirmed by MC-899; MC-3767 narrows "changed" at a re-check to the fix, see [Remediation re-checks](#remediation-re-checks-mc-3767)). Amendment: outside those cases this replaces the same-role resume-or-replace rule for a remediation re-check in [gates](gates.md). Decision-critical report claims are independently checked at the consuming decision or accepting gate; reuse adequate checks and do not add a blanket report-of-report review.

**Workflow review (MC-896).** The Orchestrator watches subagent token, tool and time data. When it sees a cheaper or faster way of working it proposes the change with the numbers (or states that a number is unavailable); the maintainer decides whether to adopt it.

### Remediation re-checks (MC-3767)

A first review of a critical contract is Opus, and so is the re-check of any fix that touches the contract. Any other fix re-check goes to a fresh Sonnet `adversarial-reviewer`, even when the whole change is critical. The accepted risk is that a fix which breaks the contract indirectly gets a weaker review.

Derived, for applying it:

- A fix touches the contract when it changes code or plan text that implements or enforces the contract, or removes or weakens one of its tests. When unsure, it touches it.
- The re-check registers under a new `logicalJobId`, with `changedContracts` naming only what the fix touches (empty for Sonnet): the controller refuses a change of contracts within one job. Its brief names the whole change's contracts, the earlier verdict and the fix diff.
- A Sonnet reviewer that finds the contract touched says so in its verdict, and that fix then gets an Opus re-check. The round count continues.
- The mandatory plan challenge and the three-reject escalation are unchanged.

## Reports and handback

Every subagent writes its full report to a Markdown file and hands back exactly three lines: the report path, `STATUS:` with the verdict or status, and `BLOCKERS/INCIDENTS:` none or the list. The aim is to keep unneeded detail out of the Orchestrator's context. Status values besides the role's own verdict: BLOCKED NEEDS GRANT, AMENDMENT REQUESTED, PARTIAL (a missing report file counts as PARTIAL; never acceptance), WRITE REFUSED (full text follows as the exception) and INCIDENT. The Orchestrator reads the verdict line first, then only the sections a decision needs, by heading or search; it verifies decision-critical claims against source itself, and a handback is never evidence. Reports put the verdict or status on line 1, a short Summary next and stable headings (Findings, Evidence, Open items). Use result.md or <id>-result.md: Claude Code blocks subagent writes named REPORT*, SUMMARY*, FINDINGS* or ANALYSIS*. Briefs name other agents' files as read-only; an agent writes or edits only files it created. The guard does not enforce this: a TEMP file is writable by every scratch role, so the Orchestrator records a verdict file's size and hash in the ledger row at hand-back and re-hashes before citing or acting on it. Scratch Write for read-mostly roles (code-searcher, haiku-triager, doc-verifier, senior-advisor and the designer) is limited to %TEMP% outside every repository; repository writes still need a per-agent exact grant under [ownership](ownership.md).

## Messages between sessions and wakes (MC-3769)

Every message or finished background job wakes a session, which re-reads its whole context.

- Message another session only when blocked, needing a decision, ready to merge or finished, plus the derived cases below. Send no acknowledgements or progress notes.
- Group background jobs, so that jobs which are used together wake the session once.
- Derived: these still get a message: an assignment or grant and its result, an answer to a question, an incident, and a correction to a fact the receiver will act on. Put everything the receiver needs in that one message. Grouping never drops the completion notification that CLAUDE.md rule 5 requires.

## Bounded nesting

Investigators, deep investigators, code-readers, performance specialists, documentation roles, test specialists and sonnet-coder may use `Agent` for bounded **read-only** help from `code-searcher`, `haiku-triager` or `record-clerk`. A nested record-clerk returns draft text to its parent; it does not write the repository. Sonnet-coder may use code-searcher/haiku-triager for bounded read-only help, with no child writes or acceptance authority. Ordinary substantial helper requests return to the parent; tiny targeted lookups remain inline. No nested write delegation. A nested helper's own report file under %TEMP% is not write delegation; the parent owns the conclusion and reads the file itself. The parent owns conclusions, source verification and its assigned writes.

Claude CLI 2.1.286 in this environment supports nested dispatch; `.claude/settings.json` uses depth 2. `Agent(type)` grants are not restricted by the allowed child names. Those names are doctrine, not a sandbox. Check actual grants; revoke overly broad fan-out if observed. Do not promise immediate profile reload without testing the current runtime.

## Escalation

Use deep-investigator when the ordinary packet contradicts itself or other evidence, leaves a decision-critical mechanism unestablished, reports an unexplained blast radius, depends on unpinned runtime/framework subtleties, suggests a load-bearing accident or requests escalation. Supply the prior packet; do not run both tiers concurrently on the same question. Arbitration (MC-785): the Orchestrator decides routine cases and records in the ledger row the single read or command that settled each. A case that is disputed or borderline by the mechanical tests in [gates](gates.md) step 5 and that one direct read or command does not settle goes to a fresh instance: opus-reviewer for a plan dispute or a verdict-classification dispute, deep-investigator for a factual or causal one. The arbiter is never the reviewer whose verdict is in dispute, nor the designer or implementer of the item; the designer is never an arbiter. The brief supplies both positions as file paths and the exact question; the arbiter returns a ruling file, not a vote. Unresolved material disagreement goes to senior-advisor.

Use senior-advisor when two materially different attempts fail, targeted investigation leaves the root cause unclear, evidence contradicts the model, a foundational assumption must change, choosing among approaches carries substantial downstream cost, a bug crosses subsystems, confidence remains insufficient, or the team loops. Also use it before implementing an expensive-to-reverse plan and after three consecutive substantive gate rejects, when the advisor also weighs a bounded subsystem rewrite against the patch path (`MC-697`). Difficulty alone is not escalation.

The advisor gets attempted approaches, observations, competing positions and contradictions, and returns ROOT CAUSE / MISSED INSIGHT / RECOMMENDED STRATEGY / NEXT INVESTIGATION / DO NOT / UNCERTAINTY. It is direction, not a second reviewer run in parallel. See [gates](gates.md) for disposition.

Record investigations and gate dispatches in the ledger from real evidence. Unknown costs stay unknown; no fabricated estimates. Budgets are reassessment checkpoints, not acceptance shortcuts. Each new dispatch must answer a distinct question or supply independent verification.

Write boundaries and checkout concurrency follow [ownership](ownership.md). Item COMPLETE requires [applicable record closeout](records.md). Doc-verifier is the ordinary Sonnet documentation checker; the Haiku review pilot was retired (MC-321 7).

## Parallel options for the maintainer (MC-1069)

At the start of a task, at each completion and whenever a code, device or records track is free, list the open tickets that could run in parallel with the current work (disjoint files and resources, already authorized or ready to size; the Roadmap and Live-State name them) and offer them to the maintainer as options with the AskUserQuestion tool (multiSelect), each with its blocker or decision need in one line. Do not start an unapproved ticket on the strength of being parallel-safe. Lane A recommends tickets with this ask and writes a staging prompt for each one chosen, naming the model (MC-4187; naming the model is derived from MC-3643); the maintainer starts the session. Other sessions offer rather than leave a free track idle. Every maintainer decision, approval and confirmation goes through AskUserQuestion, never a prose question.

## Completion notification for external runners (MC-1069)

Native Claude subagents wake the orchestrator when they finish; an external process does not. Start each external runner (Invoke-ExtModel.ps1) and each long host job with the Bash or PowerShell tool's run_in_background option, so the harness re-invokes the orchestrator at exit and lists the job as a background task. Do not use a hidden Start-Process for these. When several jobs run at once, a wake for one is also the moment to read every other finished result file.

## Test files go to the native test-warrior (MC-1070)

External Codex workers cannot run tests (their sandbox has no node_modules), and test files written blind needed host-side repair in every case (compile errors from runes, mock and global gaps, timing and shared-state leaks). A dispatch with `testOnly: true` (mode implement, every `allowedWrites` entry a test file: `*.test.*`, `*.spec.*`, a `tests/` or `__tests__/` folder, `*.harness.ts`; no critical contracts) therefore routes straight to the native `test-warrior` (Sonnet, `scheduling.testPrimary` in `.claude/workflow-policy.json`) without a Codex attempt. The production code of the same ticket is still written by Codex (or the usual route); the test-warrior runs the tests itself in the ticket's worktree and hands back with the red-before-green evidence for each reproducer. CLI: `route --job ID --mode implement --test-only true`. Haiku is not used for rig building; a one-test addition that copies a working pattern in an existing rig may be tried with a Haiku role once a measured need appears.
