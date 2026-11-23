# #709 stage handoff: spec (Studio module list operations)

- Stage: spec only (MC-3902). File: `docs/design/studio/MODULE_LIST_SPEC.md`, revision 3. The build is one PR on #709 (Studio module list page, shared `moduleListOps.ts` helpers, classic page calls the same helpers). No app code is in this PR.
- Decisions: `Agents/mc/709.md`, MC-4120 (Create asks a name first; Delete is a confirm with no Undo; MCP import admits plain `http://` only for loopback hosts, which also tightens classic; Convert asks first when Low Level Access is on). Accepted known limitation: modules from files, plugins and restores keep today's run-time MCP rule. MC-3985, MC-4030 and MC-175 apply.
- Gate 1: the designer was Opus. Round 1 [REJECT] (stdio inner-URL and userinfo bypass of the URL check; overstated security boundary; untestable withdraw-order test). Round 2 (fresh opus-reviewer) [REJECT] (inner-URL prefix mutant survived; probe assertions swallowed by the import catch). Round 3 (fresh opus-reviewer) [EDITORIAL] with E1-E4, applied in revision 3 without re-review, so the plan passed.
- **History-core status: no stage edits** `fieldRegistry.ts`, `historyModel.ts`, `ownerHistory.svelte.ts` or `studioSetters.ts`. Gate 1 r1 checked this against source. Lane A can schedule the build while another Studio ticket holds the history-core slot.
- Build stages (section 9), one PR, one coder per stage in one worktree, one combined Gate 2 by a fresh opus-reviewer, Tier 2:
  - **L1 contracts, Opus:** shared helpers, classic page calls them, `withdrawOpenModuleId`, replace-while-open "gone" behaviour. Changed critical contracts: persisted module list writes, selection gone under MC-3896.
  - **L2 page, Sonnet:** the Studio Module list page, tree entry, link changes, English keys; the translator adds the 7 locales (localeParity).
  - **L3 security, Opus:** MCP URL admission by parsed host (including the `stdio:` inner URL and userinfo forms) and the low-level ask on conversion. Changed contract: security boundary.
- Gate 2 must run mutants on the new helpers and URL admission and show the R rows failing on `origin/main`.
- Coordination: #683 S5 and L2 both edit `StudioDetail.svelte` (mechanical conflict). #708 keeps `studioOpenClassic`. #710 may reuse the page pattern.
- MC IDs MC-4121..4129 are unused.
- Scratch: gate reports and designer drafts are in the session scratchpad `...\scratchpad\709\` (gate1-r1.md, gate1-r2.md, gate1-r3.md).
