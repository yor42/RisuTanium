# Agent routing

The orchestrator owns scope, arbitration and acceptance. Preserve discovery, writing and review separation. Models below are local role aliases, not an assumed identity of the orchestrator or an Anthropic requirement. Check the installed profile's model/tool configuration before dispatch; if a requested runtime is unavailable, report that limitation and preserve the independent role boundaries in the available agent system.

## Choose by the question

A tiny, targeted lookup may run inline. Delegate substantial, batched location surveys; do not pay a dispatch for every grep. Use `rg`/`rg --files` where available, and a bounded alternative if they are unavailable. Search results give locations, not behavioral conclusions.

| Role | Tier | Question / boundary |
|---|---|---|
| `code-searcher` | Haiku | Where is X? Exhaustive matching locations, literal lines and command; no interpretation. |
| `investigator` | Sonnet | What happens, and does it matter for this decision? Compact selective evidence packet; default behavioral investigation. |
| `code-reader` | Sonnet | Describe all user capabilities of a named subsystem, enumerated from dispatch, with defaults, aliases and edge cases; mark TRACED/INFERRED and suspected bugs separately. |
| `deep-investigator` | Opus | Are we sure? Challenge a prior investigation and reopen primary sources for decision-critical claims. Escalation only. A fresh instance also arbitrates factual and causal disputes (MC-785). |
| `designer` | Opus | Turn a sizing packet into the proposed plan and the required tests (reproducers that must fail on the base, compatibility guards, mutants to kill); revise it after a Gate 1 reject. Never reviews or arbitrates its own work; the Orchestrator only routes. |
| `sonnet-coder` | Sonnet | Implement a bounded change in named files, including new English strings and call sites. |
| `test-warrior` | Sonnet | Write tests and resolve test failures; distinguish reproducers from guards. |
| `adversarial-reviewer` | Sonnet | Independently falsify routine plans and code; read-only repository access. |
| `opus-reviewer` | Opus | Review silent data-loss risk, save/persistence, format, reactive database or asset caching; also check comments, commit claims and genuine pre-change test failures. A fresh instance also arbitrates plan and verdict-classification disputes (MC-785). |
| `senior-advisor` | Fable | Direction when stuck, contradicted or at a foundational fork; challenge expensive-to-reverse plans; never write code. |
| `perf-analyzer` | Sonnet | Isolate performance/memory causes from profiles, logs and measurements before changes. |
| `doc-writer` | Sonnet | Write named Markdown from evidence; preserve confidence and mark missing evidence. No code or commits. |
| `doc-verifier` | Sonnet | Independently check claims: VERIFIED, WRONG, STALE CITATION, OVERSTATED, INCOMPLETE or UNVERIFIABLE. |
| `translator` | Sonnet | Translate English UI strings into all six non-English locales; preserve maintainer edits and syntax. |
| `haiku-editor` | Haiku | Exact, reversible mechanical edit with named files, explicit input/replacement, preservation rules and verification. No ambiguous semantics. |
| `haiku-triager` | Haiku | Read-only classification, deduplication and summaries of supplied logs/artifacts; no behavior or safety conclusions. |
| `record-clerk` | Haiku | Routine evidence-backed Markdown drafts in exact named documents; no decisions, Maintainer-Context or governance edits. |

Mechanical edits involving ambiguous meaning, configuration semantics, persistence, translations or uncertain safety escalate to the appropriate specialist. A small diff does not make a high-risk change mechanical. Log triage cannot establish a root cause. A record-clerk draft cannot settle a maintainer decision or approve a gate.

## Brief and context contract

Start from [campaign authority](../../Agents/README.md), then read only relevant original decisions through [Decision-Index](../../Agents/Decision-Index.md). Every brief names applicable `MC-` IDs and pastes the 2–5 relevant MC excerpts, not just the IDs (MC-321 2); absence of a needed product decision is a maintainer question. Every brief names the report file path and states the handback limit as a hard rule: three lines (path, STATUS, BLOCKERS/INCIDENTS), never a restated report (see Reports and handback).

Every dispatch states effort only when overriding the role default (MC-321 4). `opus-reviewer` is raised to `xhigh` per invocation only for save-format/persistence Gate 2 (MC-321 4). A raise for any other hard dispatch states its reason in the brief. A `maxTurns` stop returns partial output, which is never acceptance; re-dispatch or finish the work under a new bounded brief.

Campaign briefs, reports and replies use English; localized UI strings follow their locale requirements. A brief states: one unresolved question or writing scope; exact files/search boundary; allowed tools and write ownership; invariants and acceptance scenarios; applicable evidence and provenance; compact return format; stopping/escalation conditions. Proposed mechanisms are non-normative unless the accepted requirement actually mandates them. Equality-based skips include the change-and-return-to-origin scenario. Disproof is an acceptable investigation result.

Before Gate 1 on substantial work, a fresh agent that is not the designer of the plan lists the product and error-behaviour ambiguities with a recommended option each, and the orchestrator asks the maintainer what existing MCs do not settle (the grilling step, `MC-778`; see [gates](gates.md)). The lister reads and reports; it does not decide.

Shared procedures: `campaign-context`, `evidence-reporting`, `review-change`, `campaign-records`. Main entry: `campaign-workflow`. Actionable fork skills: `search-repository` → code-searcher, `triage-artifacts` → haiku-triager, `mechanical-edit` → haiku-editor. Skills remain short procedures; this document and [gates](gates.md) own detailed policy.

## Plans and tests

After sizing, the Orchestrator hands the designer the sizing packet path, the requirements and the 2-5 MC excerpts. The designer returns the proposed plan and the required tests, writes every plan revision after a Gate 1 `[REJECT]` or after grilling answers, and writes the MC-697 rewrite alternative when the gate calls for one. Its input is capped to those files plus, for a revision, its previous plan and the verdict or finding file; it does not read the full MC log, handoffs or ledger, and each revision is a fresh instance. The Orchestrator routes and records; it does not author or edit the plan. The designer never reviews or arbitrates: Gate 1 goes to a fresh independent reviewer, and a designer is never a Gate 1 or Gate 2 reviewer or an arbiter of any plan. Expensive-to-reverse plans still receive senior-advisor challenge. Tiny low-risk work keeps the carve-out and needs no designer. Designer cost and context are unmeasured; no saving is claimed.

## Stage coders, Opus economy and workflow review

Maintainer rules of 2026-10-30 (MC-894, MC-895, MC-896).

**Stage coders (MC-894).** Designers write plans in stage sections, each of which stands alone. After Gate 1, one fresh `sonnet-coder` implements each stage, serially in the batch's one worktree, with an exact per-stage write grant that the Orchestrator revokes before the next coder starts; tiny stages are grouped into one coder. One combined Gate 2 reviews the batch. A Gate 2 `[REJECT]` is remediated by one fresh remediation coder seeded with the verdict file, the diff and the acceptance requirements. Amendment: this replaces "the implementing worker" in [gates](gates.md) (Outcomes and remediation) with that fresh coder. One application-code writer per checkout still holds ([ownership](ownership.md)).

**Opus economy (MC-895).** Opus-tier or higher calls (`designer`, `opus-reviewer`, `deep-investigator`, `senior-advisor`, the Orchestrator) are for judgement, not for redundant or detailed work. Searches go to `code-searcher` or to a Gemini pre-locate handed to the designer, whose output is a lead until a range read confirms it. Code edits go to `sonnet-coder` or `haiku-editor`. The same diff is not given a repeat expensive review: a remediation re-check goes to a Sonnet `adversarial-reviewer` seeded with the verdict, and `opus-reviewer` or `senior-advisor` run only where [gates](gates.md) requires them (persistence-class review, the senior-advisor challenge and the three-reject escalation; lane A's reading of the maintainer's "where gates.md requires", pending confirmation, MC-895). Amendment: outside those cases this replaces the same-role resume-or-replace rule for a remediation re-check in [gates](gates.md). A Sonnet `investigator` verifies an Opus report, scoped to its decision-critical claims.

**Workflow review (MC-896).** The Orchestrator watches subagent token, tool and time data. When it sees a cheaper or faster way of working it proposes the change with the numbers (or states that a number is unavailable); the maintainer decides whether to adopt it.

## Reports and handback

Every subagent writes its full report to a Markdown file and hands back exactly three lines: the report path, `STATUS:` with the verdict or status, and `BLOCKERS/INCIDENTS:` none or the list. The aim is to keep unneeded detail out of the Orchestrator's context. Status values besides the role's own verdict: BLOCKED NEEDS GRANT, AMENDMENT REQUESTED, PARTIAL (a missing report file counts as PARTIAL; never acceptance), WRITE REFUSED (full text follows as the exception) and INCIDENT. The Orchestrator reads the verdict line first, then only the sections a decision needs, by heading or search; it verifies decision-critical claims against source itself, and a handback is never evidence. Reports put the verdict or status on line 1, a short Summary next and stable headings (Findings, Evidence, Open items). Use result.md or <id>-result.md: Claude Code blocks subagent writes named REPORT*, SUMMARY*, FINDINGS* or ANALYSIS*. Briefs name other agents' files as read-only; an agent writes or edits only files it created. The guard does not enforce this: a TEMP file is writable by every scratch role, so the Orchestrator records a verdict file's size and hash in the ledger row at hand-back and re-hashes before citing or acting on it. Scratch Write for read-mostly roles (code-searcher, haiku-triager, doc-verifier, senior-advisor and the designer) is limited to %TEMP% outside every repository; repository writes still need a per-agent exact grant under [ownership](ownership.md).

## Bounded nesting

Investigators, deep investigators, code-readers, performance specialists, documentation roles, test specialists and sonnet-coder may use `Agent` for bounded **read-only** help from `code-searcher`, `haiku-triager` or `record-clerk`. A nested record-clerk returns draft text to its parent; it does not write the repository. Sonnet-coder may use code-searcher/haiku-triager only, with no child writes or acceptance authority. No nested write delegation. A nested helper's own report file under %TEMP% is not write delegation; the parent owns the conclusion and reads the file itself. The parent owns conclusions, source verification and its assigned writes.

Claude CLI 2.1.286 in this environment supports nested dispatch; `.claude/settings.json` uses depth 2. `Agent(type)` grants are not restricted by the allowed child names. Those names are doctrine, not a sandbox. Check actual grants; revoke overly broad fan-out if observed. Do not promise immediate profile reload without testing the current runtime.

## Escalation

Use deep-investigator when the ordinary packet contradicts itself or other evidence, leaves a decision-critical mechanism unestablished, reports an unexplained blast radius, depends on unpinned runtime/framework subtleties, suggests a load-bearing accident or requests escalation. Supply the prior packet; do not run both tiers concurrently on the same question. Arbitration (MC-785): the Orchestrator decides routine cases and records in the ledger row the single read or command that settled each. A case that is disputed or borderline by the mechanical tests in [gates](gates.md) step 5 and that one direct read or command does not settle goes to a fresh instance: opus-reviewer for a plan dispute or a verdict-classification dispute, deep-investigator for a factual or causal one. The arbiter is never the reviewer whose verdict is in dispute, nor the designer or implementer of the item; the designer is never an arbiter. The brief supplies both positions as file paths and the exact question; the arbiter returns a ruling file, not a vote. Unresolved material disagreement goes to senior-advisor.

Use senior-advisor when two materially different attempts fail, targeted investigation leaves the root cause unclear, evidence contradicts the model, a foundational assumption must change, choosing among approaches carries substantial downstream cost, a bug crosses subsystems, confidence remains insufficient, or the team loops. Also use it before implementing an expensive-to-reverse plan and after three consecutive substantive gate rejects, when the advisor also weighs a bounded subsystem rewrite against the patch path (`MC-697`). Difficulty alone is not escalation.

The advisor gets attempted approaches, observations, competing positions and contradictions, and returns ROOT CAUSE / MISSED INSIGHT / RECOMMENDED STRATEGY / NEXT INVESTIGATION / DO NOT / UNCERTAINTY. It is direction, not a second reviewer run in parallel. See [gates](gates.md) for disposition.

Record investigations and gate dispatches in the ledger from real evidence. Unknown costs stay unknown; no fabricated estimates. Budgets are reassessment checkpoints, not acceptance shortcuts. Each new dispatch must answer a distinct question or supply independent verification.

Write boundaries and checkout concurrency follow [ownership](ownership.md). Item COMPLETE requires [applicable record closeout](records.md). Doc-verifier is the ordinary Sonnet documentation checker; the Haiku review pilot was retired (MC-321 7).
