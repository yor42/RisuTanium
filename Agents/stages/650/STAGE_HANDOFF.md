# #650 stage handoff (Stage 1 of 2)

## 1. Completed PR and commit

- PR: the Stage 1 PR from `claude/650-preset-toggles-c487d1` into `main` (`Refs #650`).
- Base `7817e0cee` (#651 S0b merged). Size tier 2.
- Gate 1:
  - Opus round 1: REJECT (F1: redo broke for a keyless slot).
  - Round 2: EDITORIAL.
  - An addendum for S0b's final names was accepted by lane A as Gate 1 scope.
- Gate 2: opus-reviewer, EDITORIAL. E1 (a test that an inactive undo keeps the slot key) and E2 (the banner comment) are fixed in this PR; E3 was wording in the hand-back only.

## 2. Architectural decisions

- MC-3890..3896 (`Agents/mc/650.md`). Stage 1 implements:
  - the storage side of MC-3890: active preset → working copy, inactive → its stored slot, decided by id at each read and write;
  - MC-3892: the banner key `studioBannerPresetSession`.
- MC-1758: a preset is a session owner kind (S0b `SESSION_OWNER_KINDS`). Its history is never claimed, loaded or saved.
- The reader never reports `had:false` for `customModuleToggle`, and the writer only assigns strings, never deleting the key (plan r2 C1a).
- Dirty marks come only from the existing write hook: `setting:customPromptTemplateToggle` at the top level and `setting:botPresets` for a slot. No format change, no migration.

## 3. Changed files

- New:
  - `src/ts/studio/edit/presetTarget.ts` (resolver, reader, writer, adapter)
  - `src/ts/studio/history/ownerKindRules.ts` (pure panel rules)
  - Tests: `edit/tests/presetTarget`, `presetWriteMark`, `presetOwnerSites`, `presetFixture.test-helpers`; `history/tests/ownerHistory.presetText`
  - `Agents/mc/650.md`
- Changed:
  - Registration and banner: `sessionKinds.ts`, `sessionAdapters.ts`, `studioHistoryService.svelte.ts`
  - The `never` sites in `StudioToggleUses.svelte`, `StudioHistoryPanel.svelte`, `StudioRestoreSheet.svelte`, `studioScreen.svelte.ts`, `studioToasts.ts`
  - 8 locale files
  - Type-only `StoredOwnerKey`/`StoredOwnerRecord` renames in 10 history test files and `studioStoreDoubles.ts` (#651 amendment A1)
  - A bare `DBState` mock in `LongTextField.svelte.test.ts` and `StudioRestoreSheet.formControlNames.svelte.test.ts` (test-environment load order only; the reviewer traced that production loads stores first)

## 4. Verification

- Studio vitest run: 256 files, 5626 tests pass.
- `pnpm check`: 0 errors.
- localeParity passes.
- Coder mutants: 16 of 16 killed. Reviewer mutants R1-R7: R4 survived, and the E1 test now covers it.
- Evidence (outside the repo): `%TEMP%\risu-b715\b61\c650\` (`s1-handback.md`, `s1-g2.md`, `out\`).

## 5. Known limits

- `placeLabelOf` has no entry for `customModuleToggle`, so a preset's place labels show the raw path. The character and module kinds behave the same today. Stage 2 or later may add a label.
- No UI in this stage: the builder, carry, Update all and the gone-preset flow are Stage 2.

## 6. Next stage (Stage 2, `Closes #650`)

- Plan: `plan.md` section "Stage 2" plus `plan-addendum-s0b.md` (both in `%TEMP%\risu-b715\b61\c650\`).
- Scope:
  - toggleTextPort, toggleBuilder, toggleCarryDb, the carry banner, the preview, studioScreen selection, a minimal StudioDetail branch, StudioToggleBuilder;
  - the Update all note;
  - studioToasts gone text;
  - 3 keys × 7 locales;
  - tests T5-T15, mutants M14-M27, an ordinary independent review.
- Replace `CG-C2m` rather than dropping it; lane A agreed.
- Merge origin/main before Gate 2; #651 also edits `StudioDetail.svelte`.
- PR known limits: no chip (#666, MC-3894); history of a replaced preset id becomes unreachable.
