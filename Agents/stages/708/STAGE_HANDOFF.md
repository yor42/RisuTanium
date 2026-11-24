# #708 Studio scripts kind: spec stage handoff (2026-11-24)

**Completed:** spec PR "Refs #708" adding `docs/design/studio/SCRIPTS_SPEC.md` (module and character triggers V2/V1, Lua, character background HTML, CharacterJS). No application code. Gate 1 passed on round 5 (editorial fixes applied); rounds 1-4 rejected, with a senior-advisor mechanism review after round 3. Decisions: MC-4110..4114 in `Agents/mc/708.md` (native V2 and V1 editors for all 101 effect types; import asks when Low Level Access is on; no extra ask on undo/redo/restore; CharacterJS editable text; cross-mode restore = whole-list mode switch restores as inverse replace, others refused).

**Architecture:** trigger lists reuse S7 r6 object-list ops through the history seam; every tagged trigger op carries a required `span` (`list`/`v1`/`v2`) with invariants T1-T4 (spec 4.3). The spec depends on S7-0 (`objectListOps.ts`, `objectLists.ts`, being built in #685); SC-0 needs N2-N11 from section 4.6 where S7-0 lacks them.

**Build stages (spec section 10), models and history-core status:**
- **SC-1** registry rows + 배경 HTML form: history-core (★, runs alone, short PR), Opus, Gate 2 opus-reviewer. Collision to watch: #681 S3a also appends to `FIELD_SPECS` and `TEXT_FIELD_PATHS`, amends the same literal pin in `historyModel.s1TextFields.test.ts` and edits `StudioDetail.svelte`.
- **SC-0** trigger list in the seam: history-core (★, runs alone, after S7-0 merges), Opus, opus-reviewer.
- SC-2a classic goldens and pure modules: no core, Opus (the oracle decides persisted list writes), opus-reviewer.
- SC-2b step builders: no core, Opus (persisted list writes), opus-reviewer.
- SC-3 form shell: Sonnet, opus-reviewer (security).
- SC-4 V2 event/effect lists: Sonnet, opus-reviewer (★ only if focus routing touches a core file, spec 4.3).
- SC-5 effect sheet framework + Control: Sonnet, opus-reviewer.
- SC-6..SC-9 effect categories: Sonnet, Sonnet reviewer.
- SC-10 Special/Low Level/Deprecated: Sonnet, opus-reviewer (Low Level gating).
- SC-11 V1 editor: Sonnet, opus-reviewer.
- SC-12 link removal and audit: Sonnet, Sonnet reviewer; one Note 9 layout check with synthetic data.
History-core files (spec section 10): `fieldRegistry.ts`, `historyModel.ts`, `ownerHistory.svelte.ts`, `studioSetters.ts`, `objectLists.ts` and possibly `objectListOps.ts`, plus `studioHistoryService.svelte.ts` for SC-0. SC-1 does not edit `ownerHistory.svelte.ts`. Only SC-1 and SC-0 edit them; they run one at a time under the lane A lock until each merges. #681's S3a/S3b/S3c are history-core builds queued behind S7-0, so they serialize with SC-1 and SC-0; #709's build (L2 edits `StudioDetail.svelte`) is not history-core. Suggested PR grouping is in the spec.

**Changed files:** `docs/design/studio/SCRIPTS_SPEC.md`, `Agents/mc/708.md`, this file.

**Tests:** none (docs). CI covers `docs/design/**`. All spec tests/mutants are DESIGNED, NOT DEMONSTRATED.

**Unresolved (actionable items from spec section 15 for lane A):**
- Notify the #685 S7-0 session before S7-0 merges: N9 adds per-list columns and the `span` and `created` op keys, N10 a label-agnostic listing rule, N11 a caller-supplied id; the S7-0 tables must leave room for them (else SC-0 grows or spec section 4 is revised, 4.6).
- File two follow-up tickets: "Studio: repair unreadable trigger lists" (E-a) and "Studio: drag-and-drop reorder of triggers and effects" (D8, a classic feature deferred under MC-4030).
- Also open: E-c (#714 coverage of shared-module trigger lists); K7 (homes for `showDeprecatedTriggerV2` and `showDeprecatedTriggerV1` when classic retires); the lock-list decision (Live-State lists three files, the spec's list is longer); the `areaParts.test.ts` guard grant for SC-3, SC-4, SC-5 and SC-11; lane A note on the S2 blind spot for a truthy non-boolean flag.
- Known limits in spec section 11: K10 (MAX_DELETED eviction) and K12 (fallback if S7-0 cannot record absent-list creation).

**Next stage:** lane A schedules SC-1 (can start now, independent of S7-0 but waits for any other history-core edit to merge), then SC-0 after S7-0 merges. Starts only after the maintainer is asked (MC-3621, MC-3622).
