# Item records and closeout

An item is **COMPLETE only after applicable records are current**: relevant maintainer decisions, independent gate dispositions, Roadmap/status and current-state/remaining-work records. Technical acceptance and administrative closeout are separate. A reviewer may accept behavior while the item remains awaiting record closeout; do not describe that state as COMPLETE.

## Incremental closure

The orchestrator names a record owner and identifies applicable records in the item brief. Update only the documents that actually govern the item; do not reconcile the whole historical corpus as a precondition for each item. A no-product-decision item needs no invented MC entry; a tiny correction may need only its gate disposition and relevant status/current-state note.

| Record | Required content when applicable |
|---|---|
| Maintainer-Context | Actual maintainer facts/decisions, stable next ID, exact scope and source; append only. Pending notes are not silently promoted. |
| Report / gate record | Requirements and amendments, actual reviewed snapshot, independent verdict, finding disposition, check provenance, accepted limitations and remaining uncertainty. |
| Roadmap / authoritative status | Item/stage state and remaining dependencies; COMPLETE only when technical acceptance and applicable closeout hold. |
| Live-State / Carry-Forward | What remains now, who owns it, and durable dependencies left for later stages; avoid copying the full report. |
| Investigation-Ledger | Actual dispatch/question/tier/outcome; observed usage or explicitly unavailable costs. |

The record checker independently verifies the changed claims and pointers against the accepted evidence. Ordinary drafting uses record-clerk or doc-writer and independent verification under [routing](routing.md)/[gates](gates.md); governance and actual maintainer decisions stay outside routine clerk authority. A missing record is an administrative blocker, not a new behavior defect. Closing records is incremental claim/diff verification; it does not restart Gate 2 or rerun application tests unless it exposes a substantive defect or invalidates accepted evidence.

The item owner records final closure against the accepted snapshot and the changed records, distinguishing optional improvements and unresolved work. Commit/push remains subject to the maintainer's actual authorization. Existing 2026-10-08 handoff backlog stays pending until separately reconciled; adopting this rule does not declare that backlog complete.

## Canonical reports and selected evidence

Track canonical reports and selected self-contained evidence needed to understand or reproduce accepted claims. Future curated evidence uses `Agents/Evidence/<item-id>/`. Each item folder has a brief README with:

- artifact role and the claim it supports;
- source/provenance and relevant base plus working diff, dependencies, runtime, configuration and inputs;
- observed result and limitations, separating execution from inference;
- a reproducible run recipe and exact named artifacts needed for it.

Choose compact fixtures, scripts/configs and meaningful outputs; include operational evidence needed for follow-up. A selected artifact must be safe to publish and intelligible without reconstructing an entire private scratch session. A citation does not convert a raw transcript into curated evidence automatically.

Raw transcripts, temporary outputs and disposable probes belong in local ignored scratch, normally outside the repository. Do not blanket-ignore existing tracked history or evidence, and do not delete or move legacy artifacts during this policy change. Never delete an only-copy source until curated extraction is independently reviewed **and** needed operational evidence is retained. An extraction can be incomplete even when a summary reads well.

MC-027's legacy protections remain exact: the two community-code directories in [project reference](project-reference.md) are protected; the rest of the existing evidence tree is not covered by a blanket ignore/prohibition. Curating new evidence does not authorize reading protected code, changing historical claims, publishing secrets, or discarding the raw 2026-10-08 handoff.
