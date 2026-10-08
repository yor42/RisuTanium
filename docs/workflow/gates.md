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

Retain the independent reviewer for remediation while its context remains usable and separate from implementation reasoning. Use a fresh reviewer if independence/context is compromised or a new design challenge is needed. Editorial-only fixes require checking the actual diff and corrected claims; they do not trigger application tests or unrelated cleanup. A substantive misunderstanding revealed by editing reopens analysis.

At the second substantive rejection, reconsider the mechanism. Three consecutive substantive `[REJECT]` rounds, across plan and implementation gates, require senior-advisor before a fourth revision. `[EDITORIAL]` neither counts nor breaks the streak. Do not patch indefinitely to satisfy one edge case without revisiting the shared cause or asking the maintainer about a product constraint.

One named owner runs the full checks once on the final applicable snapshot. Remediation workers run targeted tests and type checks. Repeat full checks when changes invalidate their evidence; reviewers may rerun any critical check. Documentation-only changes require documentation/configuration verification, not application tests. Budgets never turn unfinished work into approval.

## Evidence discipline

Reuse supported source observations only while they still apply. Check interpretations against their evidence; respect settled maintainer decisions and raise new consequences with the maintainer. Every decision-critical high-risk inference receives an independent source-level or execution check at the appropriate gate; the orchestrator need not repeat an adequate independent check.

Source claims name accessible source. Execution claims name command, result, code/dirty changes, dependencies, runtime, configuration and inputs. Reverify missing/ambiguous provenance, changed implementation/conditions, conflicts, overextended conclusions or critical claims lacking independent scrutiny. Count with the actual command; check arithmetic and citations. A model's VERIFIED label is not evidence. A passing mocked test is not live/native-platform proof.

Regression reproducers fail against the relevant pre-fix base on the intended defect and pass after; import/setup/missing-export failures do not qualify. Write against the unfixed behavior and record the demonstrated pre-fix failure in the gate and commit claim. Compatibility guards may pass before and after and must be labeled as guards. Diagnostic experiments establish mechanisms and usually remain in scratch. A test that only fails against an earlier draft of the new change is not a pre-fix reproducer.

Sanitizer-output assertions use jsdom, not happy-dom (MC-239), and relevant assertions must fail with an identity sanitizer. Use synthetic fixtures, isolated tests and no real-service probes. Do not claim measurement ratios are universally hardware-independent. Name runtime, hardware, inputs and limits of generalization; use [measurement procedures](../../Agents/Tools/README.md).

## Repository and comment discipline

Reviewers are read-only in the repository by doctrine. Differential tests, mutants and scratch configs stay outside the tree, with scratch/in-memory module substitution where needed. Never back up, mutate production source in place and restore it for a review. Focus fault injection on meaningful semantic failures and reuse applicable harnesses/evidence.

Code/test comments state invariants and non-obvious consequences, not history, reviewer rounds or mechanisms removed by remediation. Test titles name required behavior. No repository source line numbers in comments. Before a code gate inspect added source lines for `round [0-9]|MAJOR|MINOR|mutant|brief|first implementation|previously|no longer|used to`, then read changed comments for stale mechanisms; the search is necessary, not sufficient. Dated reports and gate records hold history and verified line references. No format churn.

## Documentation

Every AI-authored investigative report requires independent verification before final acceptance. Apply this proportionately at the report level; raw helper location maps or supplied-log triage packets are evidence inputs, not separate accepted reports.

Flow: code-reader → doc-writer → independent doc-verifier → orchestrator. Within the approved [10-item pilot](review-pilot.md), an independent Haiku reviewer may check eligible ordinary documentation/exact mechanical work; all exclusions and escalation rules apply. Sonnet remains the default outside the pilot. Existing investigator packets, measurements or gate records may go directly to the writer. Reference packets enumerate intended behavior and suspected bugs separately; suspected bugs need their own investigation/plan path before a fix.

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
| Executable behavior fix within the accepted design | Targeted independent remediation review, reusing the reviewer when independence remains; targeted checks for affected behavior. | No automatic full gate; review the affected behavior. |
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

The Gate 1 owner checks that required product decisions and load-bearing premises are resolved, stages are coherent, and verification targets the actual runtimes and failure branches. Evidence uncertainty is disclosed; a label or guessed mechanism cannot substitute for the observation needed to proceed.

## Technical acceptance and administrative closeout

A review verdict accepts the technical evidence at its stated scope. It does not make an item COMPLETE while applicable decisions, gate dispositions, Roadmap/status or current-state/remaining-work records are missing. Follow [item records](records.md) for proportionate closeout. Changed record claims receive independent verification; missing records alone do not restart Gate 2 or rerun application tests. Reopen affected technical analysis only when closeout exposes a substantive defect, contradicted evidence or invalidated acceptance.

The [Haiku pilot](review-pilot.md) is a bounded tier exception for eligible independent low-risk verification, not a waiver of application-code review, nontrivial Sonnet plan review or high-risk Opus review. Governance, consent, translation meaning, configuration behavior, source behavior, persistence/reactive database/assets/security/native-platform work is excluded.
