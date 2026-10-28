# Review gates and evidence

Every AI-authored application-code change gets a fresh independent post-implementation review. Nontrivial work also gets a plan gate before writing: features, architecture, risky/wide changes and save/persistence, reactive database, assets or Tauri platform configuration. A clearly small low-risk fix may skip the plan gate; uncertain scope/risk uses it. An implementer never self-approves.

## Gate sequence

1. Record requirements, scope, proposed approach, expected files, invariants, risks, acceptance scenarios, tests, trade-offs and upstream compatibility. Give a clean context to an independent reviewer to falsify assumptions, including accidental feature loss, existing artifact/integration failures and unsafe migration. An expensive-to-reverse plan also receives senior-advisor challenge before implementation.
2. Implement the bounded accepted plan through the appropriate worker. Keep acceptance requirements available; do not feed the implementer's private reasoning to the independent reviewer.
3. Name one full-check owner, normally the orchestrator, to run `pnpm test`, `pnpm check` and the relevant build on the final relevant application snapshot. Check exit codes. Evidence states working changes, including relevant untracked files; HEAD alone is insufficient.
4. Give a different fresh reviewer requirements, accepted plan, actual diff, relevant source and evidence. Challenge correctness, uncovered paths, assumptions, compatibility and drift. Use opus-reviewer for silent data-loss risk, save/persistence, save format, reactive database or asset caching; it also checks comments, commit claims and pre-change failures.
5. Arbitrate by evidence, not model seniority or vote. Independently verify consequential disputed claims. Unresolved material disagreement goes to senior-advisor with both positions and source evidence; unavailable escalation leaves a blocker, not acceptance.

Optional Codex integration is described in [project reference](project-reference.md). Use it when an independent toolchain is the point or the maintainer requests it; do not assume an installed plugin or invent an unavailable result.

## Outcomes and remediation

- `[REJECT]`: substantive design, logic, data-safety or test correction required.
- `[EDITORIAL]`: behavior accepted but false/misleading comments, titles, documentation or commit claims require correction.
- `[APPROVE]`: stated acceptance scenarios hold, important invariants are evidenced and no substantiated blocker remains. Non-blocking improvements are listed separately.

Consolidate remediation into one brief: each finding, affected requirement, change boundary and needed verification; separate optional improvements. Review every executable remediation's affected behavior. Reopen a broader gate for a changed shared contract/invariant, materially different design, contradicted evidence or invalidated acceptance.

Resume a finished reviewer for remediation only within about 5 minutes of its last activity. Otherwise start a fresh reviewer of the same role, seeded with the earlier verdict file, the remediation diff and the acceptance requirements; fresh context also preserves independence. A fresh reviewer continues the same round count. A new design challenge also warrants a fresh reviewer. Editorial-only fixes require checking the actual diff and corrected claims; they do not trigger application tests or unrelated cleanup. A substantive misunderstanding revealed by editing reopens analysis.

At the second substantive rejection, reconsider the mechanism: check whether the rejections come from the subsystem's structure rather than one edge case, and if so the plan author writes a short rewrite alternative beside the patch path (`MC-697`). At the third, senior-advisor weighs the rewrite against the patch. A rewrite must be bounded (one subsystem with a named interface, callers keep their contract, stored format unchanged or changed only under MC-175, MC-223 or MC-350, size estimated in files and lines) and wins only if it removes the failure class, costs about the same as or less than continued patching and keeps all working behaviour. It needs senior-advisor challenge plus maintainer approval, then a fresh Gate 1 with the reject streak reset; the old tests stay as compatibility guards and each earlier rejection finding becomes a reproducer the rewrite must pass. Three consecutive substantive `[REJECT]` rounds, across plan and implementation gates, require senior-advisor before a fourth revision. `[EDITORIAL]` neither counts nor breaks the streak. Do not patch indefinitely to satisfy one edge case without revisiting the shared cause or asking the maintainer about a product constraint.

Every Gate 1 verdict carries an advisory "Simpler path" section (`MC-777`): whether the complexity or the rejection comes from the subsystem's structure, and whether a bounded rewrite or a simpler mechanism would remove the failure class ("None found" is valid). A substantiated structural finding lets the orchestrator ask for the `MC-697` rewrite alternative at any rejection, not only the second.

One named owner runs the full checks once on the final applicable snapshot: in the multi-lane campaign, lane A runs them on the trial merge of each merge request (MC-694). Lane implementers, remediation workers and Gate 2 reviewers run targeted tests, reproducers, mutants and `pnpm check`, never the full suite. Exception: a change to shared test setup, mocks or test configuration asks lane A for one full run on the branch before Gate 2. At merge, a failing test is rerun alone: a pass that matches a known flake class is recorded and the merge proceeds; a repeat or new failure is a regression and goes back to the lane with the output. A second full run happens only when a fix changes code. Repeat full checks when changes invalidate their evidence (see Implementation briefs and hand-back). Documentation-only changes require documentation/configuration verification, not application tests. Budgets never turn unfinished work into approval.

## Evidence discipline

Reuse supported source observations only while they still apply. Check interpretations against their evidence; respect settled maintainer decisions and raise new consequences with the maintainer. Every decision-critical high-risk inference receives an independent source-level or execution check at the appropriate gate; the orchestrator need not repeat an adequate independent check.

Source claims name accessible source. Execution claims name command, result, code/dirty changes, dependencies, runtime, configuration and inputs. Reverify missing/ambiguous provenance, changed implementation/conditions, conflicts, overextended conclusions or critical claims lacking independent scrutiny. Count with the actual command; check arithmetic and citations. A model's VERIFIED label is not evidence. A passing mocked test is not live/native-platform proof.

Regression reproducers fail against the relevant pre-fix base on the intended defect and pass after; import/setup/missing-export failures do not qualify. Write against the unfixed behavior and record the demonstrated pre-fix failure in the gate and commit claim. Compatibility guards may pass before and after and must be labeled as guards. Diagnostic experiments establish mechanisms and usually remain in scratch. A test that only fails against an earlier draft of the new change is not a pre-fix reproducer.

Sanitizer-output assertions use jsdom, not happy-dom (MC-239), and relevant assertions must fail with an identity sanitizer. Use synthetic fixtures, isolated tests and no real-service probes. Do not claim measurement ratios are universally hardware-independent. Name runtime, hardware, inputs and limits of generalization; use [measurement procedures](../../Agents/Tools/README.md).

## Implementation briefs and hand-back

Standing rule from 2026-10-21 (MC-329).

- **Amendment checklist.** Every implementation brief pastes each binding Gate 1 amendment and applicable orchestrator ruling as a numbered checklist. The hand-back answers every item as met / not met / amendment requested, and the Gate 2 reviewer checks that table against the diff.
- **Fixtures built like the producer.** Fixtures for a compatibility or format rule are built the way the real producer builds them (for example upstream's actual export layout), not only through a convenience helper. Where a helper's defaults differ from the real producer, cover both.
- **Break the rule before hand-back.** The implementer breaks the new rule on purpose with mutants in scratch (a load hook or in-memory substitution, never swapping repository files) and shows that a repository test fails for each. This complements, and does not replace, the pre-fix reproducer rule in Evidence discipline.
- **Gate 2 reviewers do not rerun the full suite.** The implementer supplies no full-run log (MC-694). The reviewer reruns the reproducers, its own mutants and the targeted tests, and runs `pnpm check`. A Gate 2 approval is conditional on the single full-check owner's run of `pnpm test`, `pnpm check` and the relevant build on the trial merge; a regression found there returns to the lane as a remediation round.

## Device checks

Standing rule from 2026-10-21 (MC-330). It applies to checks on a physical Android device (currently the Note 9); browser-preview checks follow [live checks](live-checks.md).

- **Ceiling, time limit, exit.** Every device-check brief states a data-size ceiling, a time limit and a pass/fail exit for each check. No open-ended sessions.
- **PC first.** Check the logic on the PC first (headless Chrome or vitest). The device is for WebView, bridge, file-system or service behaviour only.
- **Data sized to the question.** A rate needs a synthetic set of about 200-500 MB, measured a few times and extrapolated. Large or real-shape runs are reserved for Android-only risk or pre-release (see tiered data below).
- **Keep the phone awake.** Before each run, keep the device awake while charging and exempt the app from battery optimisation. The screen stays on unless the check is about screen-off behaviour.
- **Batch.** Gather the device checks of several stages into one planned device session rather than one session per stage.

Existing practice, restated for context (not new in MC-330):

- A device agent uses only its own debug ports and port ranges, with a free-port and identity check before it drives a forward.
- Kill only processes you started; never by image name.
- Use a test-only app profile and never hand-edit app state.
- Tiered test data: small synthetic by default, large data on the PC, Note 9 large runs only for Android-specific risk or pre-release.
- A performance number names its hardware (see Evidence discipline).

## Repository and comment discipline

Reviewers are read-only in the repository by doctrine. Differential tests, mutants and scratch configs stay outside the tree, with scratch/in-memory module substitution where needed. Never back up, mutate production source in place and restore it for a review. Focus fault injection on meaningful semantic failures and reuse applicable harnesses/evidence.

Code/test comments state invariants and non-obvious consequences, not history, reviewer rounds or mechanisms removed by remediation. Test titles name required behavior. No repository source line numbers in comments. Before a code gate inspect added source lines for `round [0-9]|MAJOR|MINOR|mutant|brief|first implementation|previously|no longer|used to`, then read changed comments for stale mechanisms; the search is necessary, not sufficient. Dated reports and gate records hold history and verified line references. No format churn.

## Documentation

Every AI-authored investigative report requires independent verification before final acceptance. Apply this proportionately at the report level; raw helper location maps or supplied-log triage packets are evidence inputs, not separate accepted reports.

Flow: code-reader → doc-writer → independent doc-verifier → orchestrator. Sonnet doc-verifier is the documentation checker; the Haiku review pilot was retired (MC-321 7). Existing investigator packets, measurements or gate records may go directly to the writer. Reference packets enumerate intended behavior and suspected bugs separately; suspected bugs need their own investigation/plan path before a fix.

The verifier checks every claim against source: VERIFIED / WRONG / STALE CITATION / OVERSTATED / INCOMPLETE / UNVERIFIABLE. Preserve evidence confidence; missing evidence stays `TODO(evidence)`. Routine record-clerk drafts do not decide product policy, edit governance or replace independent verification. Persistence-touching commit messages remain in opus-reviewer's gate. Log dispatches and outcomes without altering old claim text or report numbering.

## Gate 1 and Gate 2 acceptance criteria

The orchestrator names a gate owner in the brief. The owner closes the record against the actual reviewed snapshot, with every blocking finding's disposition and the applicable check evidence. Closing a correction does not require inventing a new numbered review round.

| Gate | Ready for review | Approve / editorial / reject |
|---|---|---|
| Gate 1: plan | Concrete problem and scope; decision-critical product decisions settled (unresolved ones block the affected plan/implementation); acceptance scenarios and compatibility invariants; evidence for load-bearing premises; proposed boundary, risks and target-specific check strategy. | APPROVE when the approach can satisfy the requirements and no substantiated design/safety blocker remains. EDITORIAL when only wording/citations need evidence-backed correction. REJECT when scope, product behavior, premise, invariant or check strategy is materially unsafe/incomplete. |
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

An independent `doc-verifier` checks ordinary commit claims against the packet/source. For persistence/data-loss/reactive-database/asset-cache work, `opus-reviewer` owns the commit-message/comment check. When a message is corrected without a behavior change, the checker validates the changed claims and the gate owner records editorial closure; that correction does not automatically reopen Gate 2.

The orchestrator arbitrates findings and executes the commit only within the maintainer's existing authorization, staging exact owned paths and preserving others' work. A delegated draft or approved message is not authorization to commit or push. Use `/draft-commit` when the installed skill is available; otherwise retain the same evidence, drafting and independent-check contract.

## Before Gate 1: sizing and product behavior

For substantial work, obtain a targeted sizing/mechanism packet before planning: the actual trigger and load-bearing evidence, affected subsystems/endpoints, smallest coherent boundary and viable stages, and user-visible error behavior. Decide relevant skip/repair/refuse/pause branches before the affected plan gate. A decision-critical unresolved product question blocks that part of the plan and its implementation; continue independent work that does not depend on it.

Delegate ordinary mechanism investigation rather than asking the maintainer to design code. Ask the maintainer only for missing product trade-offs, not facts source/runtime evidence can settle. Size the shared cause instead of forcing endpoint patches to preserve an old file list. Keep the packet selective; do not inventory every speculative edge case or require a full investigation for a trivial task. The existing small, obviously low-risk plan-gate carve-out remains.

**Grilling step (`MC-778`).** For work that needs a Gate 1 plan review, after sizing and before Gate 1 an independent agent (not the plan author) reads the sizing and the draft plan and lists every product or error-behaviour ambiguity, each with a recommended option. The orchestrator drops what existing MCs already settle and asks the maintainer the rest with AskUserQuestion (recommended option first); the plan is finalised with the answers and then goes to Gate 1. This formalises the settle-decision-critical-behaviour step above. If Gate 1 still raises a product question the grilling missed, the orchestrator asks the maintainer; that missed question alone is not a substantive `[REJECT]` and does not count toward the three-reject escalation. Plan defects count as before. The tiny low-risk carve-out stays. Relayed decisions from lanes still need lane A confirmation before recording.

The Gate 1 owner checks that required product decisions and load-bearing premises are resolved, stages are coherent, and verification targets the actual runtimes and failure branches. Evidence uncertainty is disclosed; a label or guessed mechanism cannot substitute for the observation needed to proceed.

## Technical acceptance and administrative closeout

A review verdict accepts the technical evidence at its stated scope. It does not make an item COMPLETE while applicable decisions, gate dispositions, Roadmap/status or current-state/remaining-work records are missing. Follow [item records](records.md) for proportionate closeout. Changed record claims receive independent verification; missing records alone do not restart Gate 2 or rerun application tests. Reopen affected technical analysis only when closeout exposes a substantive defect, contradicted evidence or invalidated acceptance.