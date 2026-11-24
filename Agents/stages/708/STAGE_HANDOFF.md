# #708 Studio scripts kind: spec stage handoff (2026-11-24)

**Completed:** spec PR "Refs #708" adding `docs/design/studio/SCRIPTS_SPEC.md` (module and character triggers V2/V1, Lua, character background HTML, CharacterJS). No application code. Gate 1 passed on round 5 (editorial fixes applied); rounds 1-4 rejected, with a senior-advisor mechanism review after round 3. Decisions: MC-4110..4114 in `Agents/mc/708.md` (native V2 and V1 editors for all 101 effect types; import asks when Low Level Access is on; no extra ask on undo/redo/restore; CharacterJS editable text; cross-mode restore = whole-list mode switch restores as inverse replace, others refused).

**Architecture:** trigger lists reuse S7 r6 object-list ops through the history seam; every tagged trigger op carries a required `span` (`list`/`v1`/`v2`) with invariants T1-T4 (spec 4.3). The spec depends on S7-0 (`objectListOps.ts`, `objectLists.ts`, being built in #685); SC-0 needs N2-N11 from section 4.6 where S7-0 lacks them.

**Build stages (spec section 10), models and history-core status:**
- **SC-1** registry rows + 배경 HTML form: history-core (★, runs alone, short PR), Opus, Gate 2 opus-reviewer.
- **SC-0** trigger list in the seam: history-core (★, runs alone, after S7-0 merges), Opus, opus-reviewer.
- SC-2a classic goldens and pure modules: no core, Opus (the oracle decides parity).
- SC-2b step builders: no core, Opus (persisted list writes), opus-reviewer.
- SC-3 form shell: Sonnet, opus-reviewer (security).
- SC-4 V2 event/effect lists: Sonnet, opus-reviewer (★ only if focus routing touches a core file, 4.3).
- SC-5 effect sheet framework + Control: Sonnet, opus-reviewer.
- SC-6..SC-9 effect categories: Sonnet, Sonnet reviewer.
- SC-10 Special/Low Level/Deprecated: Sonnet, opus-reviewer (Low Level gating).
- SC-11 V1 editor: Sonnet, opus-reviewer.
- SC-12 link removal and audit: Sonnet, Sonnet reviewer; one Note 9 layout check with synthetic data.
Only SC-1 and SC-0 edit `fieldRegistry.ts`, `historyModel.ts`, `ownerHistory.svelte.ts`, `studioSetters.ts` (and SC-0 `studioHistoryService.svelte.ts`, `studioStoreProtocol.ts`); they run one at a time with the lane A lock until each merges. Suggested PR grouping is in the spec.

**Changed files:** `docs/design/studio/SCRIPTS_SPEC.md`, `Agents/mc/708.md`, this file.

**Tests:** none (docs). CI covers `docs/design/**`. All spec tests/mutants are DESIGNED, NOT DEMONSTRATED.

**Unresolved:** none for the maintainer. Notes for lane A (spec section 15): S2 blind spot on truthy non-boolean flag; MAX_DELETED eviction limit K10; K12 fallback if S7-0 cannot record absent-list creation.

**Next stage:** lane A schedules SC-1 (can start now, independent of S7-0 but waits for any other history-core edit to merge), then SC-0 after S7-0 merges. Starts only after the maintainer is asked (MC-3621, MC-3622).
