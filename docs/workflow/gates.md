# Review gates and evidence

Every AI-authored application-code change gets a fresh independent post-implementation review. How much planning and plan review a change gets follows its size tier below: Tier 2 gets the designer and an independent Gate 1, Tier 1 a short in-session plan, Tier 0 no plan gate; uncertain scope or risk takes the higher tier. An implementer never self-approves.

The [subscription-first contract](subscription-first.md), approved 2026-11-03, still defines batch scope, critical-contract classification, durable acceptance and device stop conditions; its route order is superseded by MC-2748 (native first). One combined plan/Gate 1/Gate 2 covers a coherent Tier 2 batch. Per-ticket commits, stage contexts and provider changes do not create additional gates.

## Size tiers (MC-2746)

The session sizes each ticket into one tier before planning and states the tier in the PR body. When in doubt, take the higher tier.

| Tier | Scope | Gates |
|---|---|---|
| 0 | Copy, style, locale, test-only or mechanical change | One independent review, then CI. No plan gate. |
| 1 | Contained logic or UI | A short plan in the session (no designer), one Gate 2, then CI. |
| 2 | Persisted format, on-device data, migration, security, signing or build pipeline, or otherwise expensive to reverse; also (derived from AGENTS.md) any change to a critical contract (format, durability/commit order, dirty-tracking dependencies, persisted read/write/GC/asset lifecycle, migration, security enforcement) or to Tauri platform configuration | Designer plan, grilling (MC-778), Gate 1, opus-reviewer for the changed critical contract, senior-advisor challenge before implementation, Gate 2, then CI. |

Tier 0 and Tier 1 replace the old undefined "tiny low-risk carve-out". Derived from the governance v2 proposal, not MC-2746 (they yield to any maintainer decision): "expensive to reverse" also covers a public API or schema; doc-verifier checks only claims that feed a decision, not every sentence of a routine document; and at the second substantive `[REJECT]`, besides reconsidering the mechanism (below), the session offers the maintainer a product simplification of the edge case that keeps failing.

## Gate sequence

1. For Tier 2: the designer produces and records requirements, scope, proposed approach, expected files, invariants, risks, acceptance scenarios, required tests (each labelled regression reproducer, compatibility guard or diagnostic, with mutants to kill), trade-offs and upstream compatibility; the Orchestrator routes and does not author the plan. Give a clean context to an independent reviewer to falsify assumptions, including accidental feature loss, existing artifact/integration failures and unsafe migration. An expensive-to-reverse plan also receives senior-advisor challenge before implementation.
2. Implement the bounded accepted plan through the appropriate worker. Keep acceptance requirements available; do not feed the implementer's private reasoning to the independent reviewer.
3. PR CI runs the full test, check and build on the PR snapshot (see CI ownership); the session runs targeted tests and `pnpm check` before pushing. Check exit codes. Evidence states working changes, including relevant untracked files; HEAD alone is insufficient.
4. Give a different fresh reviewer requirements, accepted plan, actual diff, relevant source and evidence. Challenge correctness, uncovered paths, assumptions, compatibility and drift. Use opus-reviewer when the diff changes a critical contract: format/backup compatibility, durability/commit/recovery order, dirty-tracking dependencies, persisted read/write/GC or asset lifecycle, migration, or a single point enforcing a security boundary such as network policy/permission gates/native bridges (MC-912). Name the changed contract and failure scenario; filename or save-path adjacency alone does not qualify. Ordinary review uses a fresh native Sonnet reviewer (MC-2748); it also checks comments, commit claims and pre-change failures.
5. Arbitrate by evidence, not model seniority or vote. The Orchestrator decides routine cases and records in the ledger row the single source read or command that settled each. A finding is disputed when a designer or coder report marks it REBUTTED and the reviewer's next round answers NOT ACCEPTED. A verdict is borderline when every finding is labelled SUBSTANTIVE or EDITORIAL and the token disagrees with the labels, or when the implementer rebuts a label. A disputed or borderline case that one direct read or command does not settle goes to a fresh arbiter per [routing](routing.md) before the verdict is acted on; the ruling also decides whether the round counts toward the reject streak. Independently verify consequential disputed claims. Unresolved material disagreement goes to senior-advisor with both positions and source evidence; unavailable escalation leaves a blocker, not acceptance.

Routing is native first (MC-2748): a fresh native Sonnet reviewer or coder by default, Opus for critical contracts. Codex and Antigravity are opt-in only after a route-health check less than 7 days old; cheapag and OpenRouter are inactive. Do not invent results or start a parallel Claude investigation without a distinct unanswered decision-critical question.

## Outcomes and remediation

- `[REJECT]`: substantive design, logic, data-safety or test correction required.
- `[EDITORIAL]`: behavior accepted but false/misleading comments, titles, documentation or commit claims require correction.
- `[APPROVE]`: stated acceptance scenarios hold, important invariants are evidenced and no substantiated blocker remains. Non-blocking improvements are listed separately, each classified under the follow-up policy below.

## Follow-up policy (MC-2745)

1. The reviewer gives every finding one class (MC-2745 names the classes; the definitions are derived from the governance proposal):
   - **blocks-merge**: data loss, security, OS break or softlock, or a failed acceptance row;
   - **fix-in-this-PR**: small, or adjacent to the touched code;
   - **known-limitation**: one line in the PR body.
2. Reviewers never file issues. The owning session decides what becomes an issue.
3. Before filing, the session searches open issues on the same file or area and comments on a match instead of filing. Derived: a session that touches a file closes or updates the trivial open issues on it in the same PR (fold in when touching).
4. A session files at most **2 new issues per PR**. Each uses the follow-up issue template and names an owner, a trigger ("when X is next touched" or a date) and a severity, with the `follow-up` label. More than 2 needs the maintainer's yes or folds into an existing issue.
5. "Drop with reason" is a valid leftover disposition (amends MC-2064): the PR body names the finding and why it is not worth doing.
6. A gap that a reviewer finds is not automatically a blocking gate: weigh risk reduction, test effectiveness, execution cost and blocked work, and prefer fast deterministic tests over long real-time runs (MC-2469). A non-critical gap is normally a known limitation, not a new ticket.
7. Derived: ui-audit runs batch their ticket candidates into one issue per audit, with the same cap. The template's S1-S3 severity scale is also derived.

The weekly sweep in [records](records.md#weekly-sweep-mc-2745) keeps the backlog bounded. Derived: when the closed/opened ratio falls, lane A pauses new filing in favour of sweep-and-close batches. Items marked "derived" come from the governance v2 proposal, not from MC-2745, and yield to any maintainer decision.

Consolidate remediation into one brief: each finding, affected requirement, change boundary and needed verification; separate optional improvements. Who revises. A Gate 1 `[REJECT]` goes back to the designer for the plan and required tests, one fresh instance per revision. `[EDITORIAL]` findings and non-blocking amendments on an `[APPROVE]` are carried by the Orchestrator as numbered items in the MC-329 implementation checklist; the plan is not rewritten. A Gate 2 `[REJECT]` is remediated by one fresh routine-code worker seeded with the consolidated verdict, actual diff and acceptance requirements under the accepted plan (MC-894); every Gate 2 `[REJECT]` finding states plan-level: yes/no with the plan section. The designer is re-engaged when the reviewer says yes or the implementer's hand-back says AMENDMENT REQUESTED; plan-level means a changed shared contract or invariant, a materially different design, contradicted evidence, invalidated acceptance, or a missing or wrong entry in the required-tests list, and the affected Gate 1 reopens at the affected breadth as the table below requires. After the third substantive reject the designer revises under the senior-advisor's direction; after a maintainer-approved rewrite a fresh designer writes the rewrite plan and the reject streak resets (MC-697 point 4). Review every executable remediation's affected behavior. Reopen a broader gate for a changed shared contract/invariant, materially different design, contradicted evidence or invalidated acceptance.

Resume a finished reviewer for remediation only within about 5 minutes of its last activity. Otherwise start a fresh reviewer of the same role, seeded with the earlier verdict file, the remediation diff and the acceptance requirements; fresh context also preserves independence. A fresh reviewer continues the same round count. Amendment: outside actual changed-critical-contract, mandatory plan-challenge and three-reject cases, remediation re-check uses the ordered routine independent-review route, with native Sonnet `adversarial-reviewer` as fallback (MC-895/899 and 2026-11-03 approval). The 5-minute rule applies to required native review; external independent contexts remain fresh. A new design challenge also warrants a fresh reviewer. Editorial-only fixes require checking the actual diff and corrected claims; they do not trigger application tests or unrelated cleanup. A substantive misunderstanding revealed by editing reopens analysis.

Stage risky work (derived from lane practice): split a risky tail into separately gated stages with the safe work first, state the staging plan in the brief, and name scope drift aloud instead of folding it in silently.

At the second substantive rejection, reconsider the mechanism: check whether the rejections come from the subsystem's structure rather than one edge case, and if so the designer writes a short rewrite alternative beside the patch path (`MC-697`). At the third, senior-advisor weighs the rewrite against the patch. A rewrite must be bounded (one subsystem with a named interface, callers keep their contract, stored format unchanged or changed only under MC-175, MC-223 or MC-350, size estimated in files and lines) and wins only if it removes the failure class, costs about the same as or less than continued patching and keeps all working behaviour. It needs senior-advisor challenge plus maintainer approval, then a fresh Gate 1 with the reject streak reset; the old tests stay as compatibility guards and each earlier rejection finding becomes a reproducer the rewrite must pass. Three consecutive substantive `[REJECT]` rounds, across plan and implementation gates, require senior-advisor before a fourth revision. `[EDITORIAL]` neither counts nor breaks the streak. Do not patch indefinitely to satisfy one edge case without revisiting the shared cause or asking the maintainer about a product constraint.

Every Gate 1 verdict carries an advisory "Simpler path" section (`MC-777`): whether the complexity or the rejection comes from the subsystem's structure, and whether a bounded rewrite or a simpler mechanism would remove the failure class ("None found" is valid). A substantiated structural finding lets the orchestrator ask for the `MC-697` rewrite alternative at any rejection, not only the second.

## CI ownership (MC-2014, MC-2036, MC-2240)

PR CI (`.github/workflows/ci.yml`: unit tests in three shards, `pnpm check`, build, the release check `pnpm check:dist`, a node-server smoke test and a non-blocking hono-server type check) is the full run, on the PR's own snapshot; the full run moved there from the local trial merge (MC-2014). Implementers, remediation workers and Gate 2 reviewers run targeted tests, reproducers, mutants and `pnpm check` (with `NODE_OPTIONS=--max-old-space-size=8192`, as CI does), never the full suite. A change to shared test setup, mocks or test configuration relies on its PR's CI run; no extra local full run. Local full runs exist only for APK and Gradle builds. Local run slots (MC-2036, MC-2240, MC-2243): claim a slot by a successful `mkdir` of its folder before writing `owner.txt`, release it by removing the folder; slot A (`%TEMP%\risu-b715\fullrun-slot`) is the only slot for APK and Gradle builds and also takes measurements; slot B (`fullrun-slot-b`) takes mutant sweeps and measurements; slots C, D and E (`fullrun-slot-c`, `-d`, `-e`; MC-2243) take mutant sweeps only, with a 10 GB free-RAM check before each claim; sweeps try B, C, D, E in order; measurements try B before A. Slot hygiene (derived from lane practice): `owner.txt` names the session, job and start time; release the slot on every outcome (pass, fail, crash, cancel); never remove another session's slot; a slot older than 3 hours is reported to lane A as stale, not removed; leave 90 s between two runs in the same slot. A red CI run goes to the PR's session: a failure that matches a known flake class (a test or hook timeout in a file on `Agents/Tools/full-run/flake-list.json` that passes alone, MC-1122) is rerun once and recorded; a repeat or new failure is a regression for the session to fix, and red CI the session cannot clear goes to the maintainer (MC-2015, MC-2744). CI skips Markdown, `docs/**` (except `docs/design/**`) and `Agents/**`: before merging a PR with no CI run, check that nothing under CI-covered paths imports the changed files. Documentation-only changes require documentation/configuration verification, not application tests. Budgets never turn unfinished work into approval.

## Evidence discipline

Reuse supported source observations only while their recorded read/dependency scope and relevant runtime/configuration/inputs still apply. A full-snapshot digest establishes provenance; unrelated HEAD/README changes alone do not invalidate accepted claims. Recheck scope before consumption/integration; changed relevant helpers/schema/runtime invalidate the affected claim. Check interpretations against their evidence; respect settled maintainer decisions and raise new consequences with the maintainer. Every decision-critical high-risk inference receives an independent source-level or execution check at the appropriate gate; the orchestrator need not repeat an adequate independent check. A subagent handback is a pointer to its report file, never evidence: the Orchestrator reads the verdict line and the decision-critical sections itself and verifies them against source. A verdict file in TEMP is editable by every scratch role; the Orchestrator records its size and hash in the ledger row at hand-back, re-hashes before citing or acting on it, and briefs forbid Write or Edit of any file the agent did not create. The guard does not enforce that.

Source claims name accessible source. Execution claims name command, result, code/dirty changes, dependencies, runtime, configuration and inputs. Reverify missing/ambiguous provenance, changed implementation/conditions, conflicts, overextended conclusions or critical claims lacking independent scrutiny. Count with the actual command; check arithmetic and citations. A model's VERIFIED label is not evidence. A passing mocked test is not live/native-platform proof.

Regression reproducers fail against the relevant pre-fix base on the intended defect and pass after; import/setup/missing-export failures do not qualify. Write against the unfixed behavior and record the demonstrated pre-fix failure in the gate and commit claim. Compatibility guards may pass before and after and must be labeled as guards. Diagnostic experiments establish mechanisms and usually remain in scratch. A test that only fails against an earlier draft of the new change is not a pre-fix reproducer.

Any brief that decodes a real `.bin`, backup or profile, on the PC or a phone, never prints a settings or key-like field (`*Key`, `*token`, `*secret`, `*password`, proxy and auth fields); it prints counts, lengths, booleans and opaque hashes, and writes only allowlisted fields to output files.

Sanitizer-output assertions use jsdom, not happy-dom (MC-239), and relevant assertions must fail with an identity sanitizer. Use synthetic fixtures, isolated tests and no real-service probes. Do not claim measurement ratios are universally hardware-independent. Name runtime, hardware, inputs and limits of generalization; use [measurement procedures](../../Agents/Tools/README.md).

## Implementation briefs and hand-back

Standing rule from 2026-10-21 (MC-329).

- **Amendment checklist.** Every implementation brief pastes each binding Gate 1 amendment and applicable orchestrator ruling as a numbered checklist. The hand-back answers every item as met / not met / amendment requested, and the Gate 2 reviewer checks that table against the diff.
- **Fixtures built like the producer.** Fixtures for a compatibility or format rule are built the way the real producer builds them (for example upstream's actual export layout), not only through a convenience helper. Where a helper's defaults differ from the real producer, cover both.
- **Break the rule before hand-back.** The implementer breaks the new rule on purpose with mutants in scratch (a load hook or in-memory substitution, never swapping repository files) and shows that a repository test fails for each. This complements, and does not replace, the pre-fix reproducer rule in Evidence discipline.
- **Gate 2 reviewers do not rerun the full suite.** The implementer supplies no full-run log. The reviewer reruns the reproducers, its own mutants and the targeted tests, and runs `pnpm check`. A Gate 2 approval is conditional on green PR CI; a regression found there is a remediation round in the same session.

## Device checks

Standing rule from 2026-10-21 (MC-330). It applies to checks on a physical Android device; the device policy, the per-brief checklist and the device-row template are in [live checks](live-checks.md#device-and-pc-checklist).

- **Ceiling, time limit, exit.** Every device-check brief states a data-size ceiling, a time limit and a pass/fail exit for each check. No open-ended sessions.
- **PC first (MC-2394).** Run on the PC unless the behaviour is Android-specific (WebView or TalkBack, SAF and pickers, share intents, native reply and notifications, Android lifecycle, low-spec performance); split mixed rows into a PC leg and a phone leg.
- **Data sized to the question.** A rate needs a synthetic set of about 200-500 MB, measured a few times and extrapolated. Large or real-shape runs are reserved for Android-only risk or pre-release (see the data tier rule in the checklist).
- **Power and heat.** Before each run the device stays awake while charging and the app is exempt from battery optimisation; the screen stays on unless the check is about screen-off behaviour (MC-330 item 2). Exception: thermal A/B timing runs use the dual gate before every window (screen off, battery and CPU zone both below their caps; MC-2308 method note); never keep the screen awake while cooling.
- **Batch.** Gather device checks of several stages into one planned session.
- **Stop and carry forward.** For each named claim/setup/hypothesis allow the planned check plus one targeted diagnostic retry, then park. Persist attempts and accepted limits across devices/batches/context clears. Reopen only for changed relevant implementation/setup, a new hypothesis, contradicted evidence or explicit maintainer instruction; name that predicate before dispatch. An optional inconclusive oddity does not block unrelated scope; a named required unmet claim blocks only its affected acceptance.

Ports, processes, profiles, data tiers and the rest of standing practice are in the [device and PC checklist](live-checks.md#device-and-pc-checklist). On the two Note 9s, MC-1666 allows `pm clear` and app-storage edits; elsewhere never hand-edit app state.

## Repository and comment discipline

Reviewers are read-only in the repository by doctrine. Differential tests, mutants and scratch configs stay outside the tree, with scratch/in-memory module substitution where needed. Never back up, mutate production source in place and restore it for a review. Focus fault injection on meaningful semantic failures and reuse applicable harnesses/evidence.

Code/test comments state invariants and non-obvious consequences, not history, reviewer rounds or mechanisms removed by remediation. Test titles name required behavior. No repository source line numbers in comments. Before a code gate inspect added source lines for `round [0-9]|MAJOR|MINOR|mutant|brief|first implementation|previously|no longer|used to`, then read changed comments for stale mechanisms; the search is necessary, not sufficient. Dated reports and gate records hold history and verified line references. No format churn.

## Documentation

Consequential report claims require independent source/execution verification at the consuming decision or accepting gate. Reuse that verification rather than commissioning a report-of-report pipeline or parallel full Claude investigation. Distinct unanswered claims, conflicting evidence and unmet requirements receive bounded checks. Raw location maps and log triage remain inputs, not separately accepted reports.

Flow: evidence → bounded document writer → independent claim verification → orchestrator. Routine writing and claim checks go to native doc-writer and doc-verifier (MC-2748). The Haiku review pilot remains retired (MC-321 7). Existing investigator packets, measurements or gate records may go directly to the writer. Reference packets enumerate intended behavior and suspected bugs separately; suspected bugs need their own investigation/plan path before a fix.

The verifier checks every claim against source: VERIFIED / WRONG / STALE CITATION / OVERSTATED / INCOMPLETE / UNVERIFIABLE. Preserve evidence confidence; missing evidence stays `TODO(evidence)`. Routine record-clerk drafts do not decide product policy, edit governance or replace independent verification. Commit claims about actual changed critical contracts remain in opus-reviewer's existing gate; adjacency does not add another review. Log dispatches and outcomes without altering old claim text or report numbering.

## Gate 1 and Gate 2 acceptance criteria

The orchestrator names a gate owner in the brief. The owner closes the record against the actual reviewed snapshot, with every blocking finding's disposition and the applicable check evidence. Closing a correction does not require inventing a new numbered review round.

| Gate | Ready for review | Approve / editorial / reject |
|---|---|---|
| Gate 1: plan | Concrete problem and scope; decision-critical product decisions settled (unresolved ones block the affected plan/implementation); acceptance scenarios and compatibility invariants; evidence for load-bearing premises; proposed boundary, risks and target-specific check strategy. Required tests classified and mutants named. | APPROVE when the approach can satisfy the requirements and no substantiated design/safety blocker remains. EDITORIAL when only wording/citations need evidence-backed correction. REJECT when scope, product behavior, premise, invariant or check strategy is materially unsafe/incomplete. |
| Gate 2: implementation | Accepted requirements/plan, actual final diff and dirty snapshot, applicable runtime/test evidence, comment and commit claims, and explicitly disclosed residuals within consented scope. | APPROVE when requirements/scenarios hold, invariants are evidenced, residuals are known and consented where required, and no substantiated blocker remains. EDITORIAL when behavior/evidence are accepted but a claim/title/comment is false or unclear. REJECT for a behavior, safety or meaningful verification defect. |

If implementation materially drifts from the accepted design, reopen the affected part of Gate 1; a wording correction does not retroactively require another plan gate.

| Correction / finding | Required closure | Reopen Gate 2? |
|---|---|---|
| Spelling, wording, citation or factual claim correction; executable semantics unchanged | Same independent reviewer or doc-verifier checks corrected claim against evidence and verifies an editorial-only diff; owner records closure. No application test rerun. | No new Gate 2. |
| Executable behavior fix within the accepted design | Targeted independent remediation review, resuming or replacing the reviewer per the 5-minute rule above; targeted checks for affected behavior. | No automatic full gate; review the affected behavior. |
| Shared contract/invariant change, material design change, contradicted evidence or invalidated acceptance | Reopen affected analysis/plan and the broader independent implementation gate with updated evidence. | Yes, at the affected breadth. |
| Editorial correction reveals a substantive misunderstanding | Reclassify the substantive finding as REJECT; reopen affected analysis and behavior verification. | According to the actual substantive effect. |
| Accepted optional improvement | Record as optional; do not block closure or absorb into required remediation. | No. |

The criterion is semantic effect and evidence applicability, not the label MAJOR/MINOR or the size of the text diff. Minor editorial findings never trigger a fresh Gate 2 by themselves.

## Commit-message preparation

The orchestrator supplies an evidence packet: actual diff/snapshot, requirements, test commands/results, applicable limitations, accepted gate dispositions and intended commit scope. Delegate a routine evidence-complete draft to `record-clerk` (Haiku); use `doc-writer` (Sonnet) for complex technical explanation. A draft contains no invented statistics, full-suite claims or unsupplied behavior conclusions.

An independent `doc-verifier` checks ordinary commit claims against the packet/source. For changed critical contracts under the classification above, `opus-reviewer` owns the commit-message/comment check within its existing gate; adjacency alone does not add another review. When a message is corrected without a behavior change, the checker validates the changed claims and the gate owner records editorial closure; that correction does not automatically reopen Gate 2.

The orchestrator arbitrates findings and commits under the [approval matrix](#approval-matrix-mc-2744), staging exact owned paths and preserving others' work. A delegated draft or approved message is not itself authorization; the matrix is. Use `/draft-commit` when the installed skill is available; otherwise retain the same evidence, drafting and independent-check contract.

## Before Gate 1: sizing and product behavior

For substantial work, obtain a targeted sizing/mechanism packet before planning: the actual trigger and load-bearing evidence, affected subsystems/endpoints, smallest coherent boundary and viable stages, and user-visible error behavior. Decide relevant skip/repair/refuse/pause branches before the affected plan gate. A decision-critical unresolved product question blocks that part of the plan and its implementation; continue independent work that does not depend on it.

Delegate ordinary mechanism investigation rather than asking the maintainer to design code. Ask the maintainer only for missing product trade-offs, not facts source/runtime evidence can settle. Size the shared cause instead of forcing endpoint patches to preserve an old file list. Keep the packet selective; do not inventory every speculative edge case or require a full investigation for a trivial task. Tier 0 and Tier 1 work needs no separate sizing packet.

**Grilling step (`MC-778`).** For Tier 2 work, after sizing and before Gate 1 an independent agent (not the designer) reads the sizing and the draft plan and lists every product or error-behaviour ambiguity, each with a recommended option. The orchestrator drops what existing MCs already settle and asks the maintainer the rest with AskUserQuestion (recommended option first); the designer finalises the plan with the answers and then it goes to Gate 1. This formalises the settle-decision-critical-behaviour step above. If Gate 1 still raises a product question the grilling missed, the orchestrator asks the maintainer; that missed question alone is not a substantive `[REJECT]` and does not count toward the three-reject escalation. Plan defects count as before. A session records the decisions it asked itself, with IDs from its own MC block; device-affecting rulings are asked in lane B's session directly (MC-2713).

The Gate 1 owner checks that required product decisions and load-bearing premises are resolved, stages are coherent, and verification targets the actual runtimes and failure branches. Evidence uncertainty is disclosed; a label or guessed mechanism cannot substitute for the observation needed to proceed.

## Technical acceptance and administrative closeout

A review verdict accepts the technical evidence at its stated scope. An item is COMPLETE when its PR is merged on green CI, its issue is closed with a link to the PR, its board card has moved, and every leftover is dispositioned (MC-2747; see [item records](records.md)). Changed record claims receive independent verification; missing records alone do not restart Gate 2 or rerun application tests. Reopen affected technical analysis only when closeout exposes a substantive defect, contradicted evidence or invalidated acceptance.

## Approval matrix (MC-2744)

MC-2744 (2026-11-20) makes MC-1676, MC-1677 and MC-2015 permanent and extends them to branch push and PR open. It amends MC-1069: the AskUserQuestion rule stays for everything still asked, and the per-commit, per-push and per-merge confirmations are gone. Once the maintainer has approved a ticket or task (chosen it, ordered it or queued it), its session runs it to a merged PR without asking at each step: sizing, product-decision grilling, plan, gates and their revisions, advisor escalation where the rules require it, implementation in its worktree, host tests, red-before-green and mutant evidence, remediation, then the actions below. A decision that the maintainer's records already settle is not asked again.

Rows marked MC-2744 restate it. Rows marked "derived" are this document's reading of earlier records and practice, not part of MC-2744; where one conflicts with a maintainer decision, the decision wins.

| Action | Who | Ask? | Source |
|---|---|---|---|
| Commit in the ticket worktree after Gate 2 APPROVE or EDITORIAL | ticket session | No | MC-2744 |
| Push the ticket branch; open the PR on yor42/RisuTanium (always `--repo yor42/RisuTanium`) | ticket session | No | MC-2744 |
| Turn Auto-fix on when the PR opens | ticket session | No | derived (practice since 2026-11-20) |
| Auto-fix CI commits on the PR | ticket session | No | MC-2744 |
| Merge (merge commit) when CI is green and the PR diff matches the reviewed diff | lane A | No | MC-2744, MC-2015 |
| Merge a PR that CI skips (docs or records only) when its diff matches and the import check in [CI ownership](#ci-ownership-mc-2014-mc-2036-mc-2240) passes | lane A | No | derived (MC-2015 applied to paths CI does not run) |
| PR diff differs from what was reviewed | ticket session | Re-review first | derived (MC-2015 merges only a matching diff) |
| Red CI the session cannot clear | maintainer | Yes | MC-2744, MC-2015 |
| Product, scope, persisted-format or security choice | maintainer | Yes | MC-2744 |
| Devices (the device policy and grants say which are personal) | maintainer | Yes | MC-2744 |
| Destructive cleanup | maintainer | Yes | MC-2744; a session's own clean, merged worktree is removed under MC-1918 |
| Protected paths (`docs/branding/**`, ToS, Privacy, `Legal.svelte`, signing material) | maintainer | Yes | MC-2744 |
| Closing an issue other than by the merged PR's own closing keyword | maintainer | Yes | MC-2744 (issue closes); the keyword close is derived |

**Before an unasked merge** (derived from lane A practice): Gate 2 is APPROVE; every gating device row is PASS or waived; `git merge-tree` against `origin/main` is clean; merge with `gh pr merge <n> --repo yor42/RisuTanium --merge --match-head-commit <sha>`; hold while a wait the maintainer asked for is open.

Every ask uses the AskUserQuestion tool (a push notification reaches the phone). While the work runs, other open tickets that could proceed in parallel (disjoint files and resources) are offered to the maintainer as options, as in [routing](routing.md#parallel-options-for-the-maintainer-mc-1069); lane A starts ready tickets for idle lanes without that ask (MC-1676 item 3, made permanent by MC-2744).
