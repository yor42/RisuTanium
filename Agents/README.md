# Campaign navigation and authority

Start with [Live-State](Live-State.md) after compaction, then the task-relevant decisions via [Decision-Index](Decision-Index.md) and original [Maintainer-Context](Maintainer-Context.md). Do not read every report or import the whole log.

| Document | Authority |
|---|---|
| [Maintainer-Context](Maintainer-Context.md) | Append-only maintainer facts/decisions under stable MC IDs; original entries override paraphrases. |
| [Decision-Index](Decision-Index.md) | Generated navigation to raw MC headings; no decision summaries. |
| [Roadmap](Roadmap.md) | Item scope, phase, sequencing and status. |
| [Live-State](Live-State.md) | Dated observed current work and unresolved record reconciliation; rewritten, not history. |
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

[The 2026-10-08 handoff](Handoff-2026-10-08.md) and [its evidence](Handoff-2026-10-08/) are preserved raw pending reconciliation. They contain decisions/records not yet added to the authoritative log, Roadmap or ledger. Do not silently adjudicate or promote inconsistent standing rules from them. MC-240 records the workflow cleanup authorization; MC-241 approves the six follow-up workflow policies. Neither settles the older handoff backlog.

Open specific reports from Roadmap/handoff pointers. Some `99-*` reports contain suspected bugs with per-entry confidence/status, not reproductions. A rejected/retired plan is not the accepted design; follow the final gate record. Dated line references, old hashes and counts need current verification when used as evidence.

Documentation follows evidence/code-reader → doc-writer → independent doc-verifier → orchestrator. Keep source observations, interpretations and maintainer decisions distinct. Translate all non-English locales including Korean while preserving maintainer edits (MC-058). The two protected community-code paths are listed in [project reference](../docs/workflow/project-reference.md); do not widen their prohibition to the whole evidence tree (MC-027).

Items are COMPLETE only after [applicable records close out](../docs/workflow/records.md); independent technical acceptance alone does not settle administrative status. Future curated reproducible evidence uses `Agents/Evidence/<item-id>/`, while legacy evidence and raw handoff artifacts remain intact. The [Haiku review pilot](../docs/workflow/review-pilot.md) is bounded to eligible items and remains 0/10 without observed actual Haiku executions.
