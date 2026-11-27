# #681 stage handoff: S3b (Studio character portrait), then S3a

## Completed stage: S3b

- PR: "Refs #681" from `claude/681-s3b`, base main `82d1dac4a` (after #708 SC-1, PR 766; merged with later main before the PR). Plan: `Agents/stages/681/PLAN.md` r2 S3b plus the designer delta `s3b-delta.md` (amendments A1..A8; MC-4200). Decisions: `Agents/mc/681-s3b.md` (MC-4200..).
- What landed:
  - History op `portraitSet` (whole `image` and `ccAssets` before/after, plus an optional `pngExif` pair), three labels (`portraitAdd`, `portraitRemove`, `portraitMain`, character owners only; an older parser refuses the record whole), its revert snapshot, and `holdsResultOf` that includes the exif pair.
  - Retention and GC: `stepPathsOf` names the stored files a portrait step adds or removes (`portraitPathNames`), so a removed portrait stays in the retained field; the replay file probe covers put-back portrait paths, and a gone path drops the step with `studioPortraitFileGone`.
  - Lifecycle: a removal is refused where history cannot be kept (other tab, unwritable store, unreadable retained field); an add is not. The owner is checked again when the write is made.
  - `portraitSetters.ts` builders equal classic's `selectCharImg`, `changeCharImage` and the panel's removals. The PNG text notes land in `extentions.pngExif` inside the same step; `extentions` is never replaced (the folder document lives there).
  - The add flow is a module (`portraitAddFlow.ts`), bound to its Studio visit (MC-4135 by analogy, MC-4202); `filePicker.ts` and `portraitTextChunks.ts` hold the classic chooser and chunk rules.
  - `StudioPortraitSection` mounts first inside the 사진 panel: empty state with Add, main tile with a Replace/Remove menu, other photos with Make main/Remove. No single-line text input (MC-1813 does not apply).
  - 15 new `en.ts` keys, one block after `studioScreenFillHidden`, in all 7 locales (translator); localeParity passes.
  - Test-only DT-1 (S3a leftover E2 and lane A's H4 note): each Display text field writes only its own path.
- Gate 1 (opus-reviewer) [EDITORIAL] (MC-4201). Gate 2 (opus-reviewer): round 1 [REJECT] on F1 (mutant MB18 survived: the B-T1 clone test had no existing `pngExif`); fixed by one test line and re-checked by a fresh reviewer (`gate2r.md`). MB1..MB25, MD1 and MD2 were killed in scratch; 11 reviewer mutants too.
- Critical contracts named for Gate 2: the persisted history record, retention/GC roots for portrait paths, the add/remove asset lifecycle, the replay file probe.
- Process note: the coder step stopped on the quota limit and never wrote its report; the orchestrator verified the working tree instead (targeted vitest 428 files / 12901 passed, `pnpm check` 0 errors after 14 test-file type-narrowing errors were fixed).
- Known limitations (all accepted, PR body states them):
  - E3: an add is bound to its visit. Closing Studio, or closing and reopening it, before the store resolves does not land the add; the toast says one file was not added.
  - E5: only not-landed outcomes are app-wide toasts. A landed add shows its png note only in a mounted section; the step is in History either way.
  - E6: a revert across a gone portrait path stops that chain; with nothing else to apply it is a plain `precondition` refusal.
  - E7: an unanswered probe on a put-back main portrait names the raw path.
  - F2: a file of a refused type adds nothing and says nothing (classic would have stored it); S3c reports it.
  - F3: undoing an add with notes on a character that had no `extentions` leaves `extentions: {}` (harmless for `.bin` and export).
  - F4: B-T5 asserts the retained field the keep-set reads, not `getUncleanablesSync`; B-T6 has no plain memory-only case (same `removalRefusal` branch, MB2 killed by the other cases).
- Overlap with #685 S7-1: S3b edits only `en.ts` and the 7 locales (one contiguous block after `studioScreenFillHidden`; S7-1's lore keys sit near `studioLore*`; names are distinct). It does not touch `StudioDetail.svelte`, `ownerModel.ts` or `StudioRestoreSheet.svelte`; `portraitSet` has no restore-point line. Whichever PR merges second merges main first; the conflict is mechanical.
- Device row DV-B1 (Note 9, synthetic data, lease): real chooser picks a synthetic PNG with tEXt chunks, becomes main, old main goes to alternates, png note shows; Undo then Redo; remove main (promoted toast); force-stop and relaunch (boot sweep); Undo restores the portrait and it renders. Status: see the PR body (run or dispositioned before merge).

## Next stage: S3c

- Reports a refused type and multi-file refusals (a neutral "{n} files were not added" key with the reason as `sub`), the emotion/other asset flows and the remaining S3 pieces per PLAN.md "S3c". S3c adds 6 new keys plus 1 reused (`studioImportNotAdded` is now an S3b key) and the neutral key.
- Releases the history-core slot when this PR merges; lane A decides who gets it (#708 SC-0 is next in the queue).

---
## Earlier stage: S3a (Studio name and Display fields)

### Completed stage: S3a

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
- Lane A PR check (head `fe1e975d6`): [REJECT] on B1. The name field's composition gate was not registered with `registerStudioField`, so a held IME composition was not written on page hide (MC-1813).
  - The fix registers the gate and adds lane A's probe P1 as a regression reproducer.
  - In the same push: a history-focus reveal no longer saves the Display segment choice; a guard compares the registry focus parts with the rendered parts (H4 was no real mismatch); comment and test-label edits.
  - A fresh Sonnet adversarial-reviewer approved the delta ([APPROVE], `s3a-rev3.md`).
- Process deviation: the first coder ran its reproducers and mutants by swapping repository files and restoring them, against ownership.md. Both Gate 2 rounds reran the reproducers and mutants in scratch with in-memory substitution and found no residue: the tree and patch hashes matched.
- Tests: targeted runs of `src/ts/studio`, `src/lib/Studio`, `src/ts/process`, `src/ts/themePack`, `src/App` and localeParity, all green in Gate 2 round 2 (four contention timeouts in untouched files passed on rerun; CI shard 3's `bootstrap.packSafeOrder` RS-4 timeout on fe1e975d6 passed locally and was rerun). `pnpm check` has 0 errors. The full suite runs in PR CI.
- Leftovers:
  - E2: closed by S3b's DT-1 (a typing test per Display text field; mutants MD1 and MD2 killed). Note S3a's H4 guard compares registry focus parts with rendered parts but does not tie a rendered part to its port; DT-1 does.
  - E3 (optional test, not done): nothing tests the `live.name !== nameAtFocus` guard (mutant r2M3 survived). The code was read correct.
  - F3 (known limitation, accepted): a wrong-typed `newGenData` key is overwritten by the fill as classic does, and undo deletes it instead of restoring it.
  - Known limitations accepted by lane A (MC-4137):
    - `largePortrait` and `inlayViewScreen` have no `keepForeign`, so undo deletes a stored non-boolean value rather than restoring it.
    - The per-character Display segment keys in `localStorage` are never removed.
  - Known test gaps (surviving mutants from lane A's check, which also lists S3, C2 and C5 as surviving; C4 and H4 are now killed; evidence %TEMP%\risu-b715\b61\pr758\lane-a-check.json and lane-a-delta-check.json):
    - `buildScreenModeSwitch` ignoring a stored `inlayViewScreen: false`;
    - a checkbox or select not reverting after a refused write.
  - Lane A tracks the other unregistered single-line composition gates in #752.

### History-core slot

S3a edited `fieldRegistry.ts`, `historyModel.ts`, `ownerHistory.svelte.ts` and `studioSetters.ts`; the foreign branch in `writeHeld` came from F1. The slot is released when this PR merges; lane A decides who gets it next (#708 SC-1 rebases onto S3a's blocks).

### Next stage (was S3b, now done above)

- Plan: PLAN.md "S3b". Apply the Gate 1 leftovers E1, E2, E3 and E5 (below) and re-read the anchors after S3a and any later history-core merge.
- Routing: Sonnet coder; Gate 2 by an opus-reviewer naming the history record, retention/GC and asset-lifecycle contracts; device rows for the real Android picker (Note 9, synthetic data, lease).
- Start: only after lane A grants the history-core slot and asks the maintainer (MC-3621, MC-3622).

Gate 1 leftovers still open (from the plan stage):
- E1 (S3b): move `studioImportNotAdded` into the S3b key list (15 keys, with 7 locales); S3c then has 6 new keys plus 1 reused.
- E2 (S3b/S3c): for an insert refused while Studio is still open, use a neutral "{n} files were not added" with the refusal reason. Keep "because Studio closed" for the visit-end case.
- E3 (S3b/S3c, accepted reading): MC-4135 binds an import to its Studio visit. A close followed by a reopen before the store resolves does not land the files. The portrait add follows the same rule.
- E5 (S3b): `holdsResultOf` for `portraitSet` includes `pngExif.after` when the pair is present; add a B-T10 (b) variant.

### Records

- Decisions: `Agents/mc/681.md`, MC-4130..4137. MC-4138..4139 are unused.
- Scratch: `%TEMP%\risu-b715\b61\c681\` (briefs, dispatches, `s3a-delta.md`, `s3a-code.md`, `s3a-fix1.md`, `s3a-gate2.md`, `s3a-gate2-r2.md`, patches `s3a-r1.patch` and `s3a-r2.patch`).
