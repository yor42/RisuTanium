# #681 stage handoff: S3a (Studio name and Display fields)

## Completed stage: S3a

- PR: "Refs #681" from `claude/681-s3a`, base main `dbe8084a8` (after #685 S7-0, PR 747). Plan: `Agents/stages/681/PLAN.md` r2, S3a sections, plus the anchor delta against S7-0 (DELTA NONE, five additive test-list amendments) and Gate 1 leftover E4.
- What landed:
  - Ten history registry rows (`name`, `viewScreen`, `largePortrait`, `inlayViewScreen`, `prebuiltAssetCommand` with `keepForeign`, `prebuiltAssetStyle`, four `newGenData.*`), a new persisted container seed `newGenData` (all `''`), and the four `newGenData.*` paths in `TEXT_FIELD_PATHS`. Each sits in its own commented S3a block at the tail of `FIELD_SPECS`, `FIELD_PRESENTATION` and `TEXT_FIELD_PATHS`, for the #708 SC-1 rebase.
  - The screen-mode switch (`screenModeFill.ts`): classic's fill runs on a copy and the diff becomes one undo step; filled fields are tagged "Default" with a reset (MC-4132). The inlay switch never writes `additionalAssets` (MC-4134).
  - The pure fill moved from `src/ts/process/inlayScreen.ts` to the new `inlayScreenFill.ts`. `inlayScreen.ts` re-exports it, so classic callers and the image-generation path are unchanged.
  - The Display form (`StudioDisplayForm.svelte`, `StudioDisplayScreen.svelte`) with segments 사진 / 화면 / 에셋 remembered per character (`displaySegment.ts`). `hideChatIcon` moved there with its history focus (MC-4131). The emotion list shows only for `viewScreen === 'emotion'`, as in classic.
  - The name field in Basic: an emptied name reverts on blur to its value at focus.
  - Eight new `en.ts` keys plus the reworded `studioHistoryNone`, in all 7 locales.
- Gate 2 (opus-reviewer, MC-4136):
  - Round 1 [REJECT]:
    - F1: undo of `prebuiltAssetCommand` on a card-imported character (stored `''`) did nothing, because the character writer had no foreign branch.
    - F2: three theme-pack guards failed on non-literal or camelCase part names, and on a STUDIO_SAFE panel around the merge roots.
    - F3..F5 editorial.
  - Round 2 (fresh opus-reviewer) [EDITORIAL]: passed.
  - Dispositions are recorded in MC-4137.
- Process deviation: the first coder ran its reproducers and mutants by swapping repository files and restoring them, against ownership.md. Both Gate 2 rounds reran the reproducers and mutants in scratch with in-memory substitution and found no residue: the tree and patch hashes matched.
- Tests: targeted runs of `src/ts/studio`, `src/lib/Studio`, `src/ts/process`, `src/ts/themePack`, `src/App` and localeParity, all green in Gate 2 round 2. `pnpm check` has 0 errors. The full suite runs in PR CI.
- Leftovers:
  - E2 (optional test, not done): three of the four Display text-field port pairings are not covered by a typing test (round-2 mutant r2M1 survived). The code was read correct.
  - E3 (optional test, not done): nothing tests the `live.name !== nameAtFocus` guard (mutant r2M3 survived). The code was read correct.
  - F3 (known limitation, accepted): a wrong-typed `newGenData` key is overwritten by the fill as classic does, and undo deletes it instead of restoring it.

## History-core slot

S3a edited `fieldRegistry.ts`, `historyModel.ts`, `ownerHistory.svelte.ts` and `studioSetters.ts`; the foreign branch in `writeHeld` came from F1. The slot is released when this PR merges; lane A decides who gets it next (#708 SC-1 rebases onto S3a's blocks).

## Next stage: S3b (portrait)

- Plan: PLAN.md "S3b". Apply the Gate 1 leftovers E1, E2, E3 and E5 (below) and re-read the anchors after S3a and any later history-core merge.
- Routing: Sonnet coder; Gate 2 by an opus-reviewer naming the history record, retention/GC and asset-lifecycle contracts; device rows for the real Android picker (Note 9, synthetic data, lease).
- Start: only after lane A grants the history-core slot and asks the maintainer (MC-3621, MC-3622).

Gate 1 leftovers still open (from the plan stage):
- E1 (S3b): move `studioImportNotAdded` into the S3b key list (15 keys, with 7 locales); S3c then has 6 new keys plus 1 reused.
- E2 (S3b/S3c): for an insert refused while Studio is still open, use a neutral "{n} files were not added" with the refusal reason. Keep "because Studio closed" for the visit-end case.
- E3 (S3b/S3c, accepted reading): MC-4135 binds an import to its Studio visit. A close followed by a reopen before the store resolves does not land the files. The portrait add follows the same rule.
- E5 (S3b): `holdsResultOf` for `portraitSet` includes `pngExif.after` when the pair is present; add a B-T10 (b) variant.

## Records

- Decisions: `Agents/mc/681.md`, MC-4130..4137. MC-4138..4139 are unused.
- Scratch: `%TEMP%\risu-b715\b61\c681\` (briefs, dispatches, `s3a-delta.md`, `s3a-code.md`, `s3a-fix1.md`, `s3a-gate2.md`, `s3a-gate2-r2.md`, patches `s3a-r1.patch` and `s3a-r2.patch`).
