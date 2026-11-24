# #685 stage handoff: S7-2 (Studio lorebook settings panel)

- Stage: S7-2 of `docs/design/studio/S7_LORE_SPEC.md` (section 10). PR on branch `claude/685-s7-2`, base origin/main dbe8084a8. Refs #685.
- Shipped: `src/ts/studio/edit/loreSettingsOps.ts` (pure builders `buildUseGlobal`, `buildLoreFlag`, `buildLoreNumber`, `clampLoreNumber`), `src/lib/Studio/StudioLoreSettings.svelte`, two test files (27 and 22 tests), 6 `en.ts` keys with all 7 locales. No history-core file, `StudioDetail` or `StudioHistoryPanel` touched.
- Decisions: `Agents/mc/685-s7-2-5.md`, MC-4150 (clamp and round at write; rounding is new, classic keeps decimals), MC-4151 (panel ships unmounted).
- Mechanism: writes go through `service.objEdit` (`propSet loreSettings`, plus `propSet loreExt` in the same step for the two boundary flags) and `editField(owner, 'lorePlus', bool, { coalesceKey: null })`. Number fields coalesce per field (`loreSettings:<field>`); flags and the use-global toggle never coalesce. Studio never writes `db.loreBookDepth`, `loreBookToken` or `useExperimental` (MC-4043).
- Gates: Gate 1 round 1 [REJECT] (T23e could not kill the flag-coalesce mutant; the focus test compared strings instead of rendering), answered by `s7-2-plan-rev1` and applied; Gate 2 (fresh Sonnet reviewer; no critical contract changed) [ACCEPT] with two EDITORIAL known limitations below.
- Tests: both new files pass; `src/lang` passes (127); `pnpm check` 0 errors (pre-existing warnings only). 17 mutants killed by the coder; the Gate 2 reviewer re-ran 9 of 10 in a scratch copy. Not mutation-run: M2 (covered by the exact-three-keys assertion), M4, M6, M17 (assertions exist). No separate red run on the base: the code was written before the first test run; the mutants are the red evidence.

## Instructions for S7-1 (the mount)

1. Mount `StudioLoreSettings` above the lore list for the three hosts. Props: `owner`, `service`, `editable`, `host` (`'character' | 'chat' | 'module'`), `live` (character host only), `noted`, `onOpenCharacter` (select the context character's lore kind; the component does not know tree keys). Root `data-part="studio-lore-settings"`.
2. Map `case 'prop'` to `studioLoreStepSettings` in `StudioHistoryPanel.svelte` (currently the interim `language.loreBook`). That file is not in S7-1's spec file list.
3. `src/lang/en.ts` and the locales are edited by both PRs: the second to merge rebases.
4. `registerFieldReveal` is one global slot shared with the preset form; never mount the two together.
5. Device row: the two number fields use `NumberInput` size md with no explicit `min-h-11`, so they may be under 44 dp on a phone. Check at the S7-1 mount.
