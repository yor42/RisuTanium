# Campaign navigation and authority

Start with [Live-State](Live-State.md) after compaction, then the task-relevant decisions via [Decision-Index](Decision-Index.md) and original [Maintainer-Context](Maintainer-Context.md). Do not read every report or import the whole log.

| Document | Authority |
|---|---|
| GitHub issues and project board 1 (yor42/RisuTanium) | Ticket authority: scope, status, owner, trigger. Where Roadmap disagrees, the issue wins. |
| [Maintainer-Context](Maintainer-Context.md) | Append-only maintainer facts/decisions under stable MC IDs; original entries override paraphrases. Ticket PRs write new entries to [Agents/mc/](mc/README.md), which lane A folds in here (MC-3044). |
| [Decision-Index](Decision-Index.md) | Generated navigation to raw MC headings; no decision summaries. |
| [Roadmap](Roadmap.md) | Scope history keyed to issue numbers; not the live status (see GitHub issues). |
| [Live-State](Live-State.md) | One current-state block with pointers to the latest lane handoffs; rewritten, not history. |
| Latest lane handoffs | Each lane's current queue and in-flight work (lane A keeps them); older handoffs are superseded. |
| [Carry-Forward](Carry-Forward.md) | Durable dependencies/open handoffs from finished stages. |
| [Phase2-Handoff](Phase2-Handoff.md) | Durable performance/reactivity traps; detailed policy is linked rather than duplicated. |
| [Investigation-Ledger](Investigation-Ledger.md) | Dispatches, real costs and outcomes; not a per-report status register. Absence of a row does not prove no investigation happened. |
| [Reports](Reports/) | Per-item evidence, plans, rationale and gates; preserve report numbering. |
| [Upstream-Merges](Upstream-Merges.md) | Taken/adapted/skipped upstream work and merge provenance. |
| [Maybe-Later](Maybe-Later.md) | Unscheduled ideas; presence is not approval. |
| [Tools](Tools/README.md) | Measurement procedures and fixtures. |
| [Summary](Summary.md) | Historical rounds 1–2 snapshot; verify later corrections against current records. |
| [CodexReviews](CodexReviews/) | Historical review transcripts, not operative instructions; later rounds may supersede them. |
| [Archive](Archive/2026-10-08/README.md) | Byte-preserved historical snapshots, non-operative. |

Shared instructions are [AGENTS.md](../AGENTS.md); detailed local workflow is [docs/workflow](../docs/workflow/README.md), especially [routing](../docs/workflow/routing.md) and [gates](../docs/workflow/gates.md). Agent profiles and focused skills implement that policy; tool grants must be checked, not assumed.

The untracked 2026-10-08 handoff and its evidence folder are archived out of the tree after any still-relevant item is copied into an existing issue (MC-2752). MC-240 records the workflow cleanup authorization; MC-241 approves the six follow-up workflow policies.

Open specific reports from Roadmap/handoff pointers. Some `99-*` reports contain suspected bugs with per-entry confidence/status, not reproductions. A rejected/retired plan is not the accepted design; follow the final gate record. Dated line references, old hashes and counts need current verification when used as evidence.

Documentation follows evidence → bounded writer → independent claim verification → orchestrator, on native routes by default ([routing](../docs/workflow/routing.md), MC-2748). Consequential claims are checked once at their consuming decision or accepting gate; do not add recursive report verification. `.claude/workflow-policy.json` holds the caps and routes the controller reads (it still lags MC-2748 on route order, #387) and `Workflow-State.json` holds controller state; neither replaces original decisions or source evidence. Keep source observations, interpretations and maintainer decisions distinct. Translate all non-English locales including Korean while preserving maintainer edits (MC-058). The two protected community-code paths are listed in [project reference](../docs/workflow/project-reference.md); do not widen their prohibition to the whole evidence tree (MC-027).

An item is COMPLETE when its PR is merged on green CI, its issue is closed with a link, its board card has moved and its leftovers are dispositioned ([records](../docs/workflow/records.md), MC-2747). Future curated reproducible evidence uses `Agents/Evidence/<item-id>/`, while legacy evidence and raw handoff artifacts remain intact. The Haiku review pilot was retired 2026-10-20 (MC-321 7); see [its archive](Archive/review-pilot-2026-10-20.md).
