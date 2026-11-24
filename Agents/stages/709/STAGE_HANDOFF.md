# #709 stage handoff: build (Studio module list operations)

- Stage: the build PR 750 "Closes #709" on `claude/709-module-list-build`. Plan: `docs/design/studio/MODULE_LIST_SPEC.md` (Gate 1 passed in PR 742) plus `MODULE_LIST_SPEC_AMENDMENT_3_4.md` (replaces section 3.4 during the build; as-built note at its top). Decisions: `Agents/mc/709.md` (MC-4120 product answers and the accepted MCP http limitation, MC-4121 build start, MC-4122 module-gone rule confirmed, MC-4123 device rows run before merge).
- What landed: shared `src/ts/process/moduleListOps.ts` (create, remove, global switch, export, convert) used by the classic Modules page and the new Studio Module list page (tree entry, `StudioModuleList.svelte`); `withdrawOpenModuleId` on an import replace; the module-gone notice for module keys; no Studio form writes from a teardown (S5 form, toggle text, toggle editor: a registered flush plus a deferred unmount flush that flushes before it closes the step); the MCP import prompt admits plain `http://` only for loopback hosts and judges `stdio:` inner URLs and userinfo URLs by the parsed host; converting a Low Level Access module asks first on both surfaces; 8 new keys in all 8 locales, `studioOpenModules` removed.
- History core: no stage edited `fieldRegistry.ts`, `historyModel.ts`, `ownerHistory.svelte.ts` or `studioSetters.ts`.

## Gate history, as it happened

- Spec: Gate 1 r1 [REJECT], r2 [REJECT], r3 [EDITORIAL] (E1-E4 applied afterwards and word-diffed by lane A). PR 742 merged.
- Build: the L1 coder found section 3.4 wrong (a teardown write overwrote another module's slot; the bug is also on `origin/main` through import Undo and plugin writes). The amendment was checked by an opus-reviewer on revision 1 ([REJECT]) and on revision 2 ([REJECT], one test gap). Revision 3 was never checked as text; it was read through Gate 2.
- Gate 2 r1 (opus-reviewer, contracts: persisted module writes, teardown flush, MCP URL admission, low-level confirm) was [REJECT] on one missing Studio page test for the low-level ask. Fixed in `01e7bdc0d`; a fresh Sonnet reviewer re-checked it and approved it (its file says [PASS], which is not a gate token; it means [APPROVE]).
- Lane A's check of PR 750 [REJECT]: (a) no senior-advisor pass after the third substantive reject, (b) no test killed removal of `nameGate.flush()` from the S5 registered flush, (c) records gaps. 
- Senior-advisor (fable) pass, run after lane A's check and **late**: it was due after the first amendment reject (amend-check-r1). Verdict: MECHANISM CHANGE: no; keep the built mechanism, finish with tests and records; one more test cell open (a held name composition at an outside removal), run the half-mutant sweep, ask the maintainer about MC-3896 for modules and about device rows. The advice file is session scratch (`advisor-709.md`); its conclusions are the list here. The advisor's follow-ups were done: see Tests added after Gate 2.

## Tests added after Gate 2 (guards and reproducers, stated honestly)

- T9-NAME-LEAVE and T9-NAME-CLOSE: compatibility guards (pass before and after); they kill the mutant "`nameGate.flush()` removed from the registered closure".
- T9-NAME-HIDE: a regression reproducer (fails on the pre-fix form, which was not registered with the page-hide flush).
- T9-GONE-DELETE-NAME: a regression reproducer (a held name composition at an outside `splice` removal; red on the base form). It is the only test that kills the S5 half mutant (synchronous name flush in `onDestroy`): lane A's re-run found exactly one failure in 324 files and 6788 tests (the coder's own run: the four touched suites, 59 tests, all passed before the test was added).
- Sweep scope, stated as it was: the S5 halves (name and namespace registration; synchronous name flush in `onDestroy`) were executed in this round. The toggle-text and toggle-editor halves rest on the earlier L1b mutant receipts, and the classic-page against Studio-page pairs were checked by test name only (two gaps are listed under Known limitations).
- T9-GONE-REPLACE now also holds a name composition. It does not kill the half mutant (a replace is refused even from a teardown); T9-GONE-DELETE-NAME does.
- The Studio page test for the low-level ask is a mutation-killing guard (the page already called the helper), not a reproducer.

## Disposition of what the spec and gates ask

- **Device rows (spec section 8; MC-4123, run before merge):** PENDING at this push. Rows: DV-709-1 create and open a module; DV-709-2 `.risum` import through the Android picker; DV-709-3 CharX export (save dialog and task card over Studio); DV-709-4 `internal:dice` MCP import; DV-709-5 delete; DV-709-6 replace-import with a module form open (needs a setup that really holds uncommitted text; see the advisor's row-6 notes). Results are added to this file before merge.
- **Section 12 asks:** MC-3896 applied to modules: confirmed by the maintainer (MC-4122). Grilling (MC-778): the four product questions and the F2 residual were asked and answered (MC-4120); no separate grilling pass was run; accepted by lane A, 2026-11-24. Shared-id fixture producer: none exists; the tests use hand-built pairs. The MCP fixture is hand-built too, which deviates from spec section 8: a producer exists (`importMCPModule` with `getMCPMeta` mocked) and the build did not use it in the page and helper tests (T9-MCP-STORE does pin the real stored shape).
- **MC-4121 deviation:** it named Opus coders for L1 and L3; all coders were `sonnet-coder` because the controller routes code edits to Sonnet only. The Opus Gate 2 covers the contracts.
- **T9-EXPORT-COMPAT** (`.risum` byte equality, Studio vs classic) was not built: both surfaces call the same `exportModuleRow` over unchanged exporters.

## Known limitations (each with its reason)

- MCP modules from files, plugins and restores keep today's run-time `http://` rule (accepted by the maintainer, MC-4120).
- Behaviour change: a held module draft (name composition, namespace draft, toggle text) is dropped when Studio unmounts without a close, for example when an import completion opens Settings over Studio (follow-up #754). Before this PR a teardown write could land it, and could also overwrite another module.
- The toggle builder's stale carry record (Y5) and a plugin full-list write that keeps the id and changes content are not covered by the withdraw (amendment "Not covered").
- Gate 2 F4 (the S5 deferred closure still reads form deriveds besides the captured `closing`; the service's resolve-at-write decides) and F5 (`withdrawn` is not reset at the end of a visit; no reachable path found): known, no defect observed.
- The S5 form's deferred flush has no reachable landing path today (every unmount is preceded by a registered flush or ends in a refusal); only its step close is live, so a mutant that removes the deferred flush survives by design.
- In a release build `console.*` is stripped, so the deferred closures' error logging exists in dev and tests only.
- The toggle editor's option write also relies on the inert-derived rule; T9-DEFER-STEP covers the label only (#752).
- No classic-page test of the MCP export refusal, and none of the classic global switch-off or shared-id behaviour (helper unit tests cover both).

## Follow-ups (filed by lane A, no closing keywords)

- #752: the five pre-existing Studio forms that write from `onDestroy` without a registered flush (`StudioAdvancedForm`, `StudioBiasList`, `StudioPresetAdvancedForm`, `StudioPresetBiasField`, `StudioPresetListField`), plus the toggle editor's inert-derived reliance.
- #753: the `ModuleChatMenu` (per-chat module choice) Studio counterpart.
- #754: an import from Studio opens Settings without closing Studio.

- MC IDs MC-4125..4129 are unused. Gate and coder reports live in session scratch; the decisions above are the durable record.
