# Bounded Haiku independent-verification pilot

MC-241 authorizes **10 eligible items**, counted once per task/item, not per resumed review round. Outside this pilot, doc-verifier (Sonnet) remains the ordinary documentation checker; nontrivial plan review stays Sonnet, and high-risk implementation review stays Opus under [gates](gates.md). Every AI-authored application-code change still receives independent post-implementation review.

## Eligibility and routing

Eligible work: ordinary evidence-backed documentation and exact mechanical edits whose semantics are unchanged. A syntax-only application edit may qualify only when its exact transformation, actual source context, preservation requirements and verification establish the unchanged behavior. A small diff alone is insufficient. The checker is independent of the writer and receives requirements, actual diff/snapshot, source context and evidence.

Exclude governance/policy, user-facing consent, translated meaning, configuration behavior, source behavioral changes, persistence/save formats, reactive database, asset caching, security and native-platform behavior. These use the existing specialist/default gates. This workflow-policy change is excluded from its own pilot.

Use `haiku-reviewer` only for a documented eligible item within the open pilot. Uncertain eligibility, unclear semantics, inadequate evidence or substantive interpretation escalates to Sonnet; expensive failure modes use Opus as existing policy requires. An escalation is a useful pilot outcome. Do not require a Sonnet shadow review for every successful eligible item: that would defeat the experiment. Independent checking of disputed/high-risk claims still applies.

Reviewer outcomes and incremental editorial closure follow the same [gate criteria](gates.md). No implementer self-approval, weaker evidence standard, automatic rollout or exemption from records closeout is introduced.

## Pilot record

Record each eligible item with:

| Field | Required evidence |
|---|---|
| Item ID / type | Stable task identifier; documentation or exact mechanical edit; stated eligibility and exclusions checked. |
| Base and reviewed work | Relevant base plus actual dirty/working diff and untracked inputs, not HEAD alone. |
| Runtime / model | Observed Claude execution and actual Haiku model selection; a configured alias or Codex role does not prove this. |
| Result | Verdict and findings, actual closure evidence and accepted limitations. |
| Escalation / later error | Why it escalated, or any correction/reopen/escaped defect attributable to verification. |
| Cost | Actual usage/time when observed; otherwise explicitly unavailable, never estimated as observed. |

Count only actual Claude Haiku item-level verification runs with observable model evidence. Config-only validation, unanswered smoke attempts, Codex review and rechecks of an already-counted item do not increment the count. Keep detailed item outcomes in their canonical records, with a compact pilot index here or a linked selected evidence record as they occur.

**At adoption, 2026-10-08: 0/10.** The [pilot log](review-pilot-log.md) owns current progress. No successful actual Haiku verification item or model selection was established at adoption. Earlier no-output native attempts do not count. The profile/skill may be configured without proving runtime success; record capability separately from completed items.

After 10 eligible items, present observed correctness, escalations, errors/reopens and available costs to the maintainer. The maintainer decides continuation or changes. No automatic expansion, numerical savings promise or unmeasured quality conclusion follows from configuration alone.
