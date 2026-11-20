# Item records and closeout

An item is **COMPLETE** when (MC-2747):

- its PR is merged on green CI (or, for a PR CI skips, merged with a matching diff under the [approval matrix](gates.md#approval-matrix-mc-2744));
- its GitHub issue is closed with a link to the PR (normally by the PR's own `Closes #n` keyword, one keyword per issue);
- its card on project board 1 has moved; and
- every leftover is dispositioned: fixed, a known limitation in the PR body, a follow-up issue under the [follow-up policy](gates.md#follow-up-policy-mc-2745), or dropped with a reason.

The PR body carries the gate dispositions, the decisions the session recorded (IDs from its own MC block, MC-2713) and its device rows. Technical acceptance alone is not COMPLETE. The items owed administrative closeout under the earlier record-heavy definition are bulk-closed in one sweep batch (MC-2747); no item is closed by reconstructing the old record set.

## Incremental closure

The orchestrator names a record owner and identifies applicable records in the item brief. Update only the documents that actually govern the item; do not reconcile the whole historical corpus as a precondition for each item. A no-product-decision item needs no invented MC entry; a tiny correction may need only its gate disposition and relevant status/current-state note.

| Record | Required content when applicable |
|---|---|
| Maintainer-Context | Actual maintainer facts/decisions, an ID from the session's own MC block, exact scope and source; append only. Pending notes are not silently promoted. |
| Report / gate record | Requirements and amendments, actual reviewed snapshot, independent verdict, finding disposition, check provenance, accepted limitations and remaining uncertainty. |
| GitHub issue and board 1 card (Roadmap as scope history) | Item/stage state and remaining dependencies; COMPLETE per the definition above (MC-2747). |
| Live-State / Carry-Forward | What remains now, who owns it, and durable dependencies left for later stages; avoid copying the full report. |
| Investigation-Ledger | Actual dispatch/question/tier/outcome; observed usage or explicitly unavailable costs. |

The record checker independently verifies the changed claims and pointers against the accepted evidence. Routine supplied-evidence drafting uses the dedicated primary Haiku record-clerk directly, without agy/Codex/OpenRouter preflight. Independent consequential-claim verification occurs once under [routing](routing.md)/[gates](gates.md); governance and actual maintainer decisions stay outside routine clerk authority. A missing record is an administrative blocker, not a new behavior defect. Closing records is incremental claim/diff verification; it does not restart Gate 2 or rerun application tests unless it exposes a substantive defect or invalidates accepted evidence.

When an item that changes user-visible behaviour lands on `main`, the same records pass updates the "What's different from upstream" list and its known problems on the wiki page [`docs/wiki/Changes-from-upstream.md`](../wiki/Changes-from-upstream.md), and `doc-verifier` checks that change (MC-332, amended 2026-11-06: the list moved out of the README, which keeps only a pointer to that page).

The item owner records final closure against the merged PR, distinguishing optional improvements and unresolved work. Commit, push and merge follow the [approval matrix](gates.md#approval-matrix-mc-2744). The untracked 2026-10-08 handoff backlog is archived out of the tree after any still-relevant item is copied into an existing issue (MC-2752).

## Separate records track

One workClass records / mode implement Haiku drafter may run beside the ticket sessions and device runs. Freeze its source/facts packet: exact quotations/reserved IDs, target anchors/schema, accepted gate/test provenance and limitations. Later code changes do not alter that historical batch's claims. Records completion is not a prerequisite for unrelated authorized code work.

The guard remains unchanged. Ordinary explicitly granted Markdown may be edited. A clerk's Maintainer-Context entries and Decision-Index regeneration from its session's own MC block return as a scratch packet for verified application by its session; governance, Live-State and handoff changes go to lane A (MC-2713). No shell workaround, unconfirmed ID allocation, confidence upgrade, invented decision or self-acceptance. Parent application is integration, not a second whole-batch rewrite.

Missing/contradictory facts return in one exception packet with TODO(evidence). Substantive ambiguity goes to the responsible role. Haiku unavailability/exhaustion is reported or parked for an explicit parent fallback decision; no hidden stronger-model upgrade. Correctly scoped independent review still consumes consequential changed claims once.

Earlier record failures included a forbidden AGENTS.md dependency and native Edit-tool/real-checkout instructions sent to an isolated CLI. These are packet/tool-contract mismatches, not proof that all external models are incapable of records work. Primary Haiku is the maintainer's chosen simpler clerical path.

## IDs and PR-written records (MC-2713)

- **MC ID blocks.** Each session self-assigns MC IDs from its own block of 10 and asks lane A for a new block when it runs out. Never guess an ID outside a granted block. CHORE IDs follow the same block rule where a ticket still needs one; new work is normally just its GitHub issue number.
- **What the PR records.** MC-2713 sets the blocks, lane B rulings and PR-written device rows (written from the actual diff and checked against code; lane A only routes them). Derived from it: the PR's own session is the only writer of its MC entries, appended to `Agents/Maintainer-Context.md` in its PR with the Decision-Index regenerated, and also writes its gate dispositions, known limitations and follow-ups. Lane A's batches record block grants and only those decisions-log entries not already in Maintainer-Context, checking for an existing ID first.
- **What goes through lane A.** Governance files (AGENTS.md, CLAUDE.md, `docs/workflow/**`, `.claude/**` other than `.claude/worktrees/`), `Agents/Live-State.md`, the latest lane handoffs and lane A's own decisions log. Device-affecting rulings are asked in lane B's own session, not relayed (MC-2713).
- **Index.** Every PR that appends MC entries regenerates `Agents/Decision-Index.md` after merging the latest main, and again whenever it merges main later; CI skips `Agents/**`, so `-Check` before merge is the only catch (`pwsh -NoProfile -File .claude/scripts/update-decision-index.ps1`, then `-Check`).
- **Ticket authority.** The GitHub issue on yor42/RisuTanium and its card on project board 1 are the ticket's status. `Agents/Roadmap.md` is scope history keyed to issue numbers; where the two disagree, the issue wins.
## Batching and session discipline

Records are batched per stage or batch where no maintainer decision is involved. MC entries are still recorded when the maintainer answers (MC-321 4). Live-State holds only current state plus a link to the current step handoff; superseded update paragraphs move to `Agents/Archive/`.

Preserve useful context and use a fresh Sonnet parent at a coherent handoff or when size, contamination or scope warrants it; do not reset per ticket or solely because a provider/stage changed. Write a factual `/handoff` first and retain workflow state/acceptance/parked-check lineage. The next session first checks the handoff against `git status` and `git log` before relying on it.

## Weekly sweep (MC-2745)

Once a week lane A runs a sweep batch (it may be a dedicated low-cost session). The sweep:

- closes or parks open issues untouched for 14 days that have no trigger, each with a one-line reason;
- merges duplicate issues into the oldest one;
- reports the issues opened and closed that week and the open-issue trend;
- runs the orphan sweep below over GitHub issues.

Derived reconciliation (not stated in either decision): MC-2745 has the sweep close stale issues while MC-2744 keeps issue closes in the always-asked list, so the sweep lists its proposed closes and asks the maintainer once per sweep (AskUserQuestion, multiSelect) before closing them.

## Orphan sweep and leftover disposal (MC-2064, amended by MC-2745)

The orphan sweep lists every open issue (and any open Roadmap row not yet mirrored to an issue) where either:

- the owner is not an active session and it has had no issue, PR, git or log activity for 7 days; or
- it waits on a ticket or batch that is closed or already planned.

Lane A gives each listed item a named owner with a trigger, drops it with a reason, or asks the maintainer to park it (AskUserQuestion, multiSelect).

A merge, slice close, batch plan or lane retirement is not recorded until every leftover item is dispositioned: a named owner with a trigger, a known limitation, dropped with a reason, or a maintainer park. Device results go back to the affected issue or PR in the same batch. A wait names a ticket (issue number), never a batch such as "owed to devbatchN".

## Canonical reports and selected evidence

Track canonical reports and selected self-contained evidence needed to understand or reproduce accepted claims. Future curated evidence uses `Agents/Evidence/<item-id>/`. Each item folder has a brief README with:

- artifact role and the claim it supports;
- source/provenance and relevant base plus working diff, dependencies, runtime, configuration and inputs;
- observed result and limitations, separating execution from inference;
- a reproducible run recipe and exact named artifacts needed for it.

Choose compact fixtures, scripts/configs and meaningful outputs; include operational evidence needed for follow-up. A selected artifact must be safe to publish and intelligible without reconstructing an entire private scratch session. A citation does not convert a raw transcript into curated evidence automatically.

Raw transcripts, temporary outputs and disposable probes belong in local ignored scratch, normally outside the repository. Do not blanket-ignore existing tracked history or evidence, and do not delete or move legacy artifacts during this policy change. Never delete an only-copy source until curated extraction is independently reviewed **and** needed operational evidence is retained. An extraction can be incomplete even when a summary reads well.

MC-027's legacy protections remain exact: the two community-code directories in [project reference](project-reference.md) are protected; the rest of the existing evidence tree is not covered by a blanket ignore/prohibition. Curating new evidence does not authorize reading protected code, changing historical claims, publishing secrets, or discarding the raw 2026-10-08 handoff.
