# Agent routing

The orchestrator owns scope, arbitration and acceptance. Preserve discovery, writing and review separation. Models below are local role aliases, not an assumed identity of the orchestrator or an Anthropic requirement. Check the installed profile's model/tool configuration before dispatch; if a requested runtime is unavailable, report that limitation and preserve the independent role boundaries in the available agent system.

## Choose by the question

A tiny, targeted lookup may run inline. Delegate substantial, batched location surveys; do not pay a dispatch for every grep. Use `rg`/`rg --files` where available, and a bounded alternative if they are unavailable. Search results give locations, not behavioral conclusions.

| Role | Tier | Question / boundary |
|---|---|---|
| `code-searcher` | Haiku | Where is X? Exhaustive matching locations, literal lines and command; no interpretation. |
| `investigator` | Sonnet | What happens, and does it matter for this decision? Compact selective evidence packet; default behavioral investigation. |
| `code-reader` | Sonnet | Describe all user capabilities of a named subsystem, enumerated from dispatch, with defaults, aliases and edge cases; mark TRACED/INFERRED and suspected bugs separately. |
| `deep-investigator` | Opus | Are we sure? Challenge a prior investigation and reopen primary sources for decision-critical claims. Escalation only. |
| `sonnet-coder` | Sonnet | Implement a bounded change in named files, including new English strings and call sites. |
| `test-warrior` | Sonnet | Write tests and resolve test failures; distinguish reproducers from guards. |
| `adversarial-reviewer` | Sonnet | Independently falsify routine plans and code; read-only repository access. |
| `opus-reviewer` | Opus | Review silent data-loss risk, save/persistence, format, reactive database or asset caching; also check comments, commit claims and genuine pre-change test failures. |
| `senior-advisor` | Fable | Direction when stuck, contradicted or at a foundational fork; challenge expensive-to-reverse plans; never write code. |
| `perf-analyzer` | Sonnet | Isolate performance/memory causes from profiles, logs and measurements before changes. |
| `doc-writer` | Sonnet | Write named Markdown from evidence; preserve confidence and mark missing evidence. No code or commits. |
| `doc-verifier` | Sonnet | Independently check claims: VERIFIED, WRONG, STALE CITATION, OVERSTATED, INCOMPLETE or UNVERIFIABLE. |
| `translator` | Sonnet | Translate English UI strings into all six non-English locales; preserve maintainer edits and syntax. |
| `haiku-editor` | Haiku | Exact, reversible mechanical edit with named files, explicit input/replacement, preservation rules and verification. No ambiguous semantics. |
| `haiku-triager` | Haiku | Read-only classification, deduplication and summaries of supplied logs/artifacts; no behavior or safety conclusions. |
| `record-clerk` | Haiku | Routine evidence-backed Markdown drafts in exact named documents; no decisions, Maintainer-Context or governance edits. |
| `haiku-reviewer` | Haiku | Independent verification only for eligible items in the [10-item pilot](review-pilot.md); uncertainty escalates, no governance/high-risk review. |

Mechanical edits involving ambiguous meaning, configuration semantics, persistence, translations or uncertain safety escalate to the appropriate specialist. A small diff does not make a high-risk change mechanical. Log triage cannot establish a root cause. A record-clerk draft cannot settle a maintainer decision or approve a gate.

## Brief and context contract

Start from [campaign authority](../../Agents/README.md), then read only relevant original decisions through [Decision-Index](../../Agents/Decision-Index.md). Every brief names applicable `MC-` IDs; absence of a needed product decision is a maintainer question.

Campaign briefs, reports and replies use English; localized UI strings follow their locale requirements. A brief states: one unresolved question or writing scope; exact files/search boundary; allowed tools and write ownership; invariants and acceptance scenarios; applicable evidence and provenance; compact return format; stopping/escalation conditions. Proposed mechanisms are non-normative unless the accepted requirement actually mandates them. Equality-based skips include the change-and-return-to-origin scenario. Disproof is an acceptable investigation result.

Shared procedures: `campaign-context`, `evidence-reporting`, `review-change`, `campaign-records`. Main entry: `campaign-workflow`. Actionable fork skills: `search-repository` → code-searcher, `triage-artifacts` → haiku-triager, `mechanical-edit` → haiku-editor. Skills remain short procedures; this document and [gates](gates.md) own detailed policy.

## Bounded nesting

Investigators, deep investigators, code-readers, performance specialists, documentation roles, test specialists and sonnet-coder may use `Agent` for bounded **read-only** help from `code-searcher`, `haiku-triager` or `record-clerk`. A nested record-clerk returns draft text to its parent; it does not write the repository. Sonnet-coder may use code-searcher/haiku-triager only, with no child writes or acceptance authority. No nested write delegation. The parent owns conclusions, source verification and its assigned writes.

Claude CLI 2.1.286 in this environment supports nested dispatch; `.claude/settings.json` uses depth 2. `Agent(type)` grants are not restricted by the allowed child names. Those names are doctrine, not a sandbox. Check actual grants; revoke overly broad fan-out if observed. Do not promise immediate profile reload without testing the current runtime.

## Escalation

Use deep-investigator when the ordinary packet contradicts itself or other evidence, leaves a decision-critical mechanism unestablished, reports an unexplained blast radius, depends on unpinned runtime/framework subtleties, suggests a load-bearing accident or requests escalation. Supply the prior packet; do not run both tiers concurrently on the same question.

Use senior-advisor when two materially different attempts fail, targeted investigation leaves the root cause unclear, evidence contradicts the model, a foundational assumption must change, choosing among approaches carries substantial downstream cost, a bug crosses subsystems, confidence remains insufficient, or the team loops. Also use it before implementing an expensive-to-reverse plan and after three consecutive substantive gate rejects. Difficulty alone is not escalation.

The advisor gets attempted approaches, observations, competing positions and contradictions, and returns ROOT CAUSE / MISSED INSIGHT / RECOMMENDED STRATEGY / NEXT INVESTIGATION / DO NOT / UNCERTAINTY. It is direction, not a second reviewer run in parallel. See [gates](gates.md) for disposition.

Record investigations and gate dispatches in the ledger from real evidence. Unknown costs stay unknown; no fabricated estimates. Budgets are reassessment checkpoints, not acceptance shortcuts. Each new dispatch must answer a distinct question or supply independent verification.

Write boundaries and checkout concurrency follow [ownership](ownership.md). Item COMPLETE requires [applicable record closeout](records.md). Doc-verifier remains the ordinary Sonnet checker outside the explicitly bounded Haiku pilot.
