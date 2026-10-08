# Workflow improvements — 2026-10-08

The maintainer accepted six proposals: “suggestions seems reasonable. prioritize 1,4, then 2,3, and 5,6.” MC-241 records that authorization as an amendment within MC-240's workflow/document scope. Application source, legacy artifact deletion/moves and reconciliation of the older handoff backlog remain outside this task. MC-244 later authorizes separate workflow/document commits; pushing remains unauthorized.

## Priority and acceptance record

| Priority | Accepted policy | Implemented documentation | Verification / operational status |
|---|---|---|---|
| 1 | Records are part of item completion; technical acceptance and administrative closeout are distinct. | [records](records.md), [gates](gates.md), AGENTS pointers and `close-item` skill. | Independently accepted; this item's records are closed incrementally. Legacy backlog remains pending. |
| 4 | Targeted sizing and relevant product error decisions before substantial Gate 1. | [gates](gates.md): mechanism, subsystems, coherent stages and skip/repair/refuse/pause decisions; unresolved critical product questions block affected implementation. | Policy written; trivial low-risk carve-out preserved. This is not a speculative exhaustive edge-case investigation requirement. |
| 2 | Canonical reports and selected reproducible evidence; raw temporary artifacts stay local scratch. | [records](records.md): future `Agents/Evidence/<item-id>/` README/provenance/run recipe; protect only-copy sources until extraction review and operational evidence retention. | No raw artifacts deleted/moved; existing tracked evidence/history and exact MC-027 protection preserved. |
| 3 | Ten-item independent Haiku verification pilot for narrow low-risk work. | [review pilot](review-pilot.md), [routing](routing.md), gates/root pointers. | 0/10; actual Claude Haiku/model evidence required. Configuration is not an executed pilot item. Sonnet default and high-risk Opus gates remain. |
| 5 | One app-code writer per checkout; parallel distinct app items use isolated worktrees and integration owner. | [ownership](ownership.md). | Policy written; no worktrees or application writes performed by this task. Named disjoint document writers remain allowed. |
| 6 | Narrow direct Write/Edit ownership guard with explicit limitations. | [ownership](ownership.md), project hooks, registration/revocation and identity-context scripts. | Configuration and script behavior independently accepted; 84 synthetic checks passed with zero skipped groups. Native Desktop hook loading remains unverified. No filesystem-sandbox or universal shell-enforcement claim. |

## Evidence and preservation

Relevant settled context: MC-027 exact protected community directories, MC-175/223 two-way backup compatibility and named/confirmed oversize exception, MC-239 sanitizer evidence rules. Those safety constraints are unchanged. Existing workflow cleanup files remain in flight; the earlier [audit](audit-2026-10-08.md) retains its own event/results rather than being rewritten as this improvement's history.

This record separates policy implementation from runtime capability and independent acceptance. Reviewers must verify changed claims, pilot exclusions/count, applicable completion criteria, preservation and any actual hook/settings evidence. No application tests are needed for documentation-only edits; supporting script/configuration changes need their own targeted checks. No fabricated dispatch counts, token costs, savings, model selections or successful hook invocations.

## Executed checks and review closure

- `pwsh -NoProfile -File .claude/scripts/test-write-guard.ps1`: the final implementation snapshot passed 84 synthetic checks, zero skipped groups. The independent reviewer executed the preceding 82-case suite and verified the final equivalent hashing and Markdown-role bounds. Reworked path, duplicate-key and typed-manifest cases isolate their intended protections; the suite also includes broader denial guards.
- `pwsh -NoProfile -File .claude/scripts/validate-workflow.ps1`: 17 profiles, 13 skills and all covered active document targets passed. The generated decision index includes the current original maintainer headings; index freshness passed. Counts change when records are added, so the validator derives them.
- Installed `yaml` 2.8.2 parsed all 30 agent/skill frontmatter blocks with duplicate-key checks. This establishes metadata syntax, not native loading or actual model selection.
- All 99 protected launch/manifest/handoff files match the original SHA-256 baseline. Application-source/package paths have no new diff. No source edits, commit/push, worktree creation or raw-artifact deletion/move occurred at this MC-241 verification; subsequent MC-244 authorizes separate workflow/document commits.
- The plan gate rejected exit-0-only denial once, then approved exit-2 denial and explicit hook failure limits. Implementation review closed typed/duplicate JSON, Windows aliases, role bounds, unnecessary reader registration and test-adequacy findings through focused remediation. Final independent verdict: `[APPROVE]` at the policy/configuration/script scope.
- A bounded native Haiku triage retry after the quota reset again returned no output and was interrupted through its own session handle, exit 1. The cause is undetermined. It does not establish model selection, native hook loading or a completed review-pilot item.

[Selected reproducible evidence](../../Agents/Evidence/workflow-mc241/README.md) points to the checked-in scripts and run recipe. Ledger rows 1421 onward record actual dispatches and unavailable usage honestly. This is incremental administrative/editorial closure, not a renewed Gate 2.

**Status: COMPLETE for the approved policy, configuration and reproducible script-verification scope.** Native Desktop guard smoke validation and the ten-item Haiku experiment remain explicit operational follow-ups. The [pilot log](review-pilot-log.md) owns current progress; it is 0/10 at this closeout. Earlier pending campaign records remain unreconciled.
