# #650 stage handoff (Stage 2 of 2, final)

## 1. Completed PRs

- Stage 1: yor42/RisuTanium#698, merged as `f9f6f16c1`.
  - Opus Gate 1: REJECT, then EDITORIAL.
  - Opus Gate 2: EDITORIAL. Its E1/E2 fixes were re-reviewed: APPROVE on `7213cb3d3`.
- Main fix: yor42/RisuTanium#702.
  - #698 and #679's #697 conflicted only in types, which left `pnpm check` red on main.
  - The fix renames types in two of #679's S1 test files.
- Stage 2: the PR from `claude/650b-preset-builder` (`Closes #650`). Size tier 2; this stage had an ordinary review.
  - Gate 2: adversarial-reviewer, EDITORIAL, on `7bdaca5b2`, the Stage 2 work merged with origin/main `71882fe16`.
  - Its two items are known limits (section 5) and the main fix above.

## 2. Architectural decisions

- MC-3890..3896 (`Agents/mc/650.md`), as follows:
  - MC-3890: every preset can be edited.
  - MC-3891: carry reaches the global value plus loaded chats.
  - MC-3892: the page-session banner.
  - MC-3893: Update all reaches the character and modules, with a note.
  - MC-3894: no chip; that is #666.
  - MC-3895: an active-keeps warning in the carry question.
  - MC-3896: when the preset is gone, a notice shows, the selection clears and unsent typing is dropped.
- Stage 1, the storage side:
  - A preset is a session owner kind (MC-1758): its history is never stored.
  - Writes go to the working copy when the preset is active, otherwise to its slot. The choice is made by the preset's id at every read and write.
  - Only the existing write-hook marks are used.
  - No format change and no migration.
- Stage 2, the UI side:
  - The selection pins a preset by id (`selectedPresetId`), and a reorder moves only the index key (`followStudioPreset`), so the builder stays mounted.
  - The preset carry is held in the session only (`carryKept: 'session'`) and never reaches localStorage.
  - The preview and stars use `prompt` only while the preset is active.

## 3. Changed files (Stage 2)

- Source:
  - `presetTarget.ts`: two new exports only.
  - `toggleTextPort.ts`, `toggleBuilder.svelte.ts`, `toggleCarryDb.ts`, `togglePreviewModel.ts`, `studioScreen.svelte.ts`, `studioToasts.ts`.
  - Svelte: `StudioDetail.svelte` (one derived value, an arm in the pinned-preset effect, one render branch; no formLive branch touched), `StudioToggleBuilder`, `StudioToggleCarryBanner`, `StudioTogglePreview`, `StudioToggleUses`.
- 3 keys in 8 locales: `studioRefusalPresetGone`, `studioTgUpdateAllPresetNote`, `studioTgCarryActiveKeeps`.
- Tests:
  - New: `StudioDetail.presetToggles`, `toggleBuilder.presetCarry`, `toggleCarryDb.preset`, `togglePreviewModel.preset`.
  - Rows added: `StudioToggleCarryBanner`, `StudioToggleUses`, `toggleUpdateAllDb`.
  - `CG-C2m` in `StudioDetail.moduleToggles` is replaced by "a preset mounts the builder of its toggles", as lane A agreed.
  - The Stage 1 gone-wording pin in `presetOwnerSites` is updated to the new text.

## 4. Verification (Stage 2)

- On the merged tree: Studio, Studio lib and lang vitest, 277 files, 5913 tests pass.
- `pnpm check`: the only errors on the merged tree are #679's 4, fixed by #702. The Stage 2 tree before the merge: 0 errors.
- Mutants M14-M27: all killed, with M22 and M26 run as two variants each (16 runs).
- Evidence (outside the repo): `%TEMP%\risu-b715\b61\c650\` (`s2-handback.md`, `s2-g2.md`, `s2-tl.md`, `out\`).

## 5. Known limits

- There is no Studio save chip for preset writes: MC-3894, follow-up #666.
- Page-session history of a preset whose id is replaced (import or restore) becomes unreachable. Nothing is stored, so nothing is lost on disk.
- `placeLabelOf` has no entry for `customModuleToggle`, so a preset's place label shows the raw path. Character and module labels behave the same.
- No UI-level test covers Update all with no bound character. `readUpdateReach` is unchanged, and the DB-level private-character row passes.
- The translator marked the Vietnamese `studioTgCarryActiveKeeps` as low confidence.
- No device rows: the database rules and components run under jsdom with the real write hook.

## 6. Leftovers

- #666: the preset save chip, already filed (MC-3894).
- No other follow-up.
