# #708 stage SC-2a handoff (2026-11-24): classic goldens and pure trigger modules

**Completed:** PR "Refs #708" on `claude/708-sc2a` adds the pure modules `triggerKinds.ts`, `triggerTemplates.ts`, `triggerV2Defaults.ts` and `triggerV2Blocks.ts` under `src/ts/studio/edit/`, two `export` keywords in `referenceTargets.ts`, and the classic-golden tests (recorder driving the real unchanged classic components in jsdom; the oracle `classicTriggerOracle.ts` holds `CLASSIC_V2ELSE_DEFAULT` and any verbatim copies it names; no app code imports it). Classic (`src/lib/SideBars/Scripts`) and all history-core files are unchanged; no locale keys.

**Decisions:** MC-4115 (start SC-2a, Sonnet orchestrator), MC-4116 (non-object effect element is a typeless row, functions never throw), MC-4117 (`replaceEffect` returns null when an Else toggle has no matching `v2EndIndent`). Both are named exceptions to TS11 parity.

**Gates:** Gate 1 passed on round 2 (round 1 rejected on the TS11-E goldens). Gate 2 rejected round 1 (edit cells passed on a `replaceEffect` that lost the edit; test-only fix) and passed round 2 as editorial. Mutants: 27 of 28 plan mutants killed; RM1 (mutates the test driver) not run; reviewer's own 11 mutants, 10 killed, the survivor X7 removes a guard that is redundant in classic too.
**Routing note:** the workflow controller routes implement dispatches only to `sonnet-coder` on Sonnet, so both coders ran on Sonnet, not Opus as lane A asked; Gate 2 was opus-reviewer. The write guard did not recognise the session worktree, so each coder needed an exact instance grant from `register-write-scope.ps1`.

**Edit-cell contract (amended at Gate 2):** classic's edited row equals the input row with the typed text set; Studio must equal it directly, with no null masking.
**Known limits (PR body):** `moveEffectUp/Down` are move semantics, not classic's Alt swap; `moveEffect` is classic-compared only at the Up/Down targets; the goldens are recorded live from classic, so snapshot them before classic is retired.

**Next:** SC-2b (step builders) needs S7-0 merged; lane A asks the maintainer before each stage start. SC-1 and SC-0 also wait for the history-core slot.

---

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
