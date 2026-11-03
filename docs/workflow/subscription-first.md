# Subscription-first campaign execution

The maintainer approved this overhaul in the 2026-11-03 workflow conversation after independent plan and fallback-amendment review, and authorized implementation once [lane A paused](../../Agents/Handoff-2026-11-02-laneA.md). This supplements MC-785, MC-888, MC-894, MC-895, MC-896, MC-899 and MC-912. Original MC entries remain append-only. The [policy table](../../.claude/workflow-policy.json) implements these decisions; [Workflow-State](../../Agents/Workflow-State.json) indexes receipts and remaining work without replacing evidence or campaign authorities. The [cutover record](2026-11-03-workflow-cutover.md) records actual verification and activation limits.

The later [parallel-track and Haiku-records amendment](2026-11-03-parallel-tracks.md), scheduling ID `2026-11-03-parallel-records`, is additive to revision `2026-11-03.1`. Existing registered/running identities and accepted evidence remain.

## Route before dispatch

Sonnet coordinates the project. Preserve independent discovery, design, implementation, review and arbitration contexts. Native role names describe responsibilities and fallbacks; except for the explicit primary records/design/high-risk/escalation routes, their presence does not justify spending Claude quota before eligible external routes.

| Work | Ordered routes |
|---|---|
| Ordinary scouting, location surveys, bounded mechanism investigation and log triage | Antigravity `gemini-3.8-flash-low` or `gemini-3.8-flash-medium`; signed-in Codex `gpt-6-luna` low/medium; eligible paid OpenRouter Flash; designated native role |
| Supplied-evidence routine records/commit-message drafting | Native record-clerk, Haiku low, directly; no external preflight or self-acceptance |
| Routine code, tests, other documentation and independent routine review | Signed-in Codex `gpt-6-sol` medium; eligible paid OpenRouter Flash; native Sonnet role |
| Plans and required-test design | Native Opus `designer`, fresh per substantive revision |
| Changed critical-contract review | Native `opus-reviewer` |
| Mandatory advisor challenge or disputed factual/verdict arbitration | Existing designated native role under existing escalation conditions |

A tiny targeted lookup remains inline. For externally routed work, the parent dispatches directly through the controller and external runner; do not launch a Claude relay to operate Codex/Antigravity. External workers receive the bounded task and necessary source/instructions, never the whole campaign log or recursive workflow. Antigravity is read-only scouting in this version. Writing Codex workers use an isolated exported workspace, never the main checkout. Claimed success, changed-path lists and VERIFIED labels are not host evidence.

Use `node .claude/scripts/workflow-control.mjs --help` for the checked-in interface and [external tools](../../Agents/Tools/README.md#external---bounded-external-workers) for export/runner details. Registered dispatch identity binds role, logical job/stage, policy revision, model, effort, input scope and ownership. Renaming an ordinary task to a different native profile cannot bypass routing.

Quota/unavailability comes from host/provider output, not worker self-report. Cache unavailable routes until their reported reset or explicit refresh; do not probe them per ticket. A failed external result gets at most one bounded correction across the entire logical job, including provider changes, continuation and context clear. Then advance to the permitted fallback or park. No automatic Argon, GPT-6.1 Sol/Astra or other model upgrade. Native fallback uses existing subscription quota only: never enable extra usage, API billing, recharge or new keys. Exhausted native quota parks work with a factual checkpoint.

Per-invocation defaults are 8 minutes scouting, 20 coding and 12 reviewing, maximum 30 minutes. A correction is a separately counted invocation. Stop only the runner-owned process tree. Partial output or timeout is not acceptance. Preserve host-verified partial files/tests, pending work and sanitized progress when changing provider; do not restart a whole task merely because the provider changed.

## Batch and accept once

Maintain one dependency-aware ordered queue feeding two disjoint code worktrees, one device runner and one Haiku records drafter. Fill ready authorized code slots at start/resume, completion and parked waits. A device wait or administrative closeout blocks affected acceptance/release/COMPLETE only, not unrelated code work. Batch related tickets around a coherent mechanism and common acceptance scope; ticket/commit boundaries do not create extra gates. Nontrivial batches get one combined Gate 1 and one fresh combined Gate 2. One fresh coder owns each coherent stage; tiny stages may be grouped. A fresh remediation coder receives consolidated findings. One application-code writer per checkout remains mandatory. At most two actual code writers run in separate explicitly prepared Git worktrees with one integration owner. Independent device/records tracks do not consume those slots; read-only work and disjoint documents are not code writers. Exact file/resource overlaps still serialize affected scope.

Classify risk by the changed contract. Opus is required for changes to save format or backup compatibility; durability, commit or recovery order; dirty-tracking mutation dependencies; persisted read/write/GC or asset lifecycle; migrations; or a single point enforcing a security boundary. Name the contract and failure scenario. Filename, save-path adjacency, type-only cleanup or unrelated display work does not itself trigger Opus. Uncertain contract impact gets a bounded mechanism check before gate selection. Expensive-to-reverse challenge and three-substantive-reject escalation remain.

Every application-code change still gets fresh independent review. Routine gates and remediation use the ordinary-review route; the reviewer cannot be designer, implementer or disputed reviewer. Supply accepted limitations and pending required claims by reference across context changes. Unsupported suspicion is not a blocker without a concrete failure or required missing evidence. Provider, context and stage changes alone never reopen gates.

Independently verify consequential report claims at the consuming decision or accepting gate. Reuse those source checks; do not add a full parallel Claude investigation or report-of-report verification because an external model produced the input. Raw search/triage packets remain leads. A distinct unanswered decision-critical claim, conflict or unmet acceptance scenario warrants a bounded further check. Full reports/gate records are evidence; three-line handbacks are pointers.

A snapshot digest establishes provenance, not universal applicability. Record host-approved read/dependency scope and relevant runtime, configuration and inputs per accepted claim; recheck that scope before consumption/integration. Changed helpers/schema/runtime affecting a claim invalidate it; unrelated README changes, commits or HEAD movement do not reopen all gates. One named owner runs full application checks on the final applicable snapshot. Targeted remediation and records reuse still-applicable evidence. Governance-only changes use governance/script checks, not the full application suite.

## Scheduling classes and records

Mode is the execution dimension; workClass code|records|device|documents is admission. Records/documents cannot conceal application/configuration writes. New clerical authoring uses workClass records, mode implement, role record-clerk, Haiku low. Preserve old saved JSON/hash/route during validation; legacy scheduling inference must not reroute existing workers. Continuations retain class, corrections and acceptance.

Supply a bounded frozen records packet with exact quotations/reserved IDs, target anchors, accepted gate/test provenance and limits. The clerk edits only explicitly granted ordinary Markdown. Authoritative decision/governance/index/state changes return as scratch text for verified parent application. Missing evidence stays TODO(evidence); hard judgement goes to its responsible role, not a hidden upgrade. Independently verify consequential claims once.

Prepare source worktrees under [ownership](ownership.md#independent-tracks-and-worktree-procedure), already authorized for ready existing TODOs. External workers run directly in sanitized exports, without extra Claude relay parents. Device build phases reserve mutable checkout/output resources; the run phase uses an immutable APK hash/source/configuration record and releases unrelated source work. Declare device serials, individual tcp ports and canonical checkout/build paths.

## Durable state and integration

The parent writes state through the locked, generation-checked helper. State holds policy revision, batch/stage, receipt pointers/hashes/applicability, required pending claims, parked checks, attempt/correction lineage, queue and integration journal pointers. Detailed prompts/logs live in ignored `.claude/scratch/dispatches/`; persistent acceptance reports retain their existing evidence locations. State and scratch receipts cannot grant new product authority.

Export intended dirty tracked files/deletions and explicitly named untracked inputs with relative paths; exclude secrets, protected community code, reparse points and ambient worker configuration. Host-check actual changes and allowed paths before integration. Worker metadata cannot grant write scope. Preserve existing host work and recheck relevant dependencies.

Multi-file integration uses `prepared` → `applying` → `applied-without-acceptance` → `reconciled`. Flush a journal before mutation binding approved operations, payload hashes, destination pre/post existence/type/hash and relevant dependencies. Check each preimage. Recovery classifies actual state as postimage, pending preimage or conflict. Preserve conflicts and require explicit recovery disposition; never blindly replay, overwrite unrelated changes or roll back others' work. Applied files still need independent acceptance. This does not claim power-loss atomicity.

## Device stop rule

Retain PC-first synthetic checks, data ceilings, time limits and pass/fail exits. Batch device checks. For a named claim/setup/hypothesis allow the planned check plus one targeted diagnostic retry. Persist attempts and accepted limitations or unresolved claims across devices, batches and context clears. Then park. Reopen only for changed relevant implementation/setup, a genuinely new hypothesis, contradicted evidence or explicit maintainer instruction; name the predicate first.

An inconclusive optional oddity does not block unrelated work. Only an explicitly required unmet claim blocks its affected scope. Do not rerun accepted gaps merely to empty the remaining-work list. Read current Live-State/accepted receipts/latest handoff to identify remaining required device claims; a historical resume list must not resurrect completed checks. This stop rule never declares unmet claims passed.

## Paid fallback

OpenRouter follows eligible subscription routes. Its sole allowed API model is `deepseek/deepseek-v4.1-flash`; OpenCode's configuration spelling, if later approved, is `openrouter/deepseek/deepseek-v4.1-flash`. No hidden research/escalation/fallback model or auto-router. Cheap Agent is not activated by this overhaul; stock auto-land, review suppression and escalation cannot replace host integration and gates.

Caps are $0.50 per logical job, $5 per KST day and $30 per KST calendar month, shared across local processes/worktrees. All paid attempts, correction, continuation, restart and permitted server attempts share the original job cap; a calendar/context/provider change cannot renew it. Native subscription use stays outside the paid ledger.

Before paid work, atomically reserve the job's entire remaining permitted allowance, bounded by actual costs, unresolved liabilities and outstanding reservations against available day/month funds. Before each request atomically commit its verified conservative complete-request cost bound: cache-miss input, all allowed output/reasoning, fees and every allowed retry/server attempt. Unknown or unverifiable rates, bounds or reconciliation stop paid calls and retain unresolved commitments. Reconcile cost before releasing funds; rollover cannot discard liabilities or silently refresh authority. Rebind period reservations before further dispatch where necessary. A dedicated-key provider cap is a backstop, not proof that delayed/in-flight remote charges cannot overshoot.

Reject unsupported model substitution, unbounded attempts and requests beyond the reservation. If these constraints cannot be validated, paid activation stays disabled and routing advances or parks. Do not invent rates or paid-success evidence. [OpenRouter fallbacks](https://openrouter.ai/docs/guides/routing/model-fallbacks) operate within API requests, not across signed-in CLIs; [provider spend controls](https://openrouter.ai/docs/guides/best-practices/spend-controls) supplement local accounting.
