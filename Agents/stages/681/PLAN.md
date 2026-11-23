STATUS: PLAN READY (r2)

# #681 Studio S3 plan: S3a name and Display, S3b portrait, S3c real Add (revision 2)

## Summary

- Three PRs on #681 (MC-4130); only S3c closes it. All three start after #685 S7-0 merges and re-read the anchors listed under "S7-0 collision anchors".
- S3a: ten registry rows, a `newGenData` container seed, four `newGenData.*` paths in the text router, one mode-switch step (classic fill on a copy, MC-4132; exact changed-key op list), the Display form with three gated segments and counts, `hideChatIcon` moved there (MC-4131), the name field in Basic. The inlay switch writes no `additionalAssets` (MC-4134).
- S3b: one new history op kind `portraitSet` (whole `image` + `ccAssets`, optional `pngExif` pair, MC-4133); the revert snapshot of the portrait target is `{ image, ccAssets, pngExif }` (F1); a `goneKind: 'portrait'` marker drives one gone-file text in all three render sites (F3). Critical contract; opus-reviewer.
- S3c: real picker for assets and emotions, U4 fix, and MC-4135: an import belongs to the Studio visit it started in; if the visit ends before the insert, nothing is inserted and one app-wide toast `studioImportNotAdded(n)` reports the count.
- New premise (REOPENED): `closeStudio` keeps `studioScreen.chaId` and `visitId` (`studioScreen.svelte.ts:198-201`, `:118-140`), so the service guard alone does not refuse an insert after Studio closes with the selection unchanged. S3c therefore checks the visit itself.
- No open product questions: MC-4134 and MC-4135 settle r1's OQ-1 and OQ-2.
- Blocking caveat: every reproducer below is DESIGNED, NOT DEMONSTRATED.

## Revision 2 changes

| finding | disposition | where fixed |
|---|---|---|
| F1 (substantive) revert net-zero snapshot must cover `pngExif` | ADDRESSED | S3b Model bullet "Revert chains"; B-T10 case (d); mutant MB16 |
| F2 (substantive) MC-4135 not built into S3c | ADDRESSED | S3c "Import job and the Studio visit"; acceptance C4; tests C-T8, C-T9; mutants MC6..MC9; locale key `studioImportNotAdded(n)`; Open items rewritten |
| F3 portrait gone notice mechanism and missing render site | ADDRESSED | S3b "Gone-file notice"; `StudioScreen.svelte` and `studioToasts.ts` in Expected files; test B-T14; mutant MB17 |
| F4 test classifications | ADDRESSED | Required tests: acceptance rows relabelled "acceptance (new behaviour)"; B-T12 relabelled; A-T11, A-T12, C-T1 stay reproducers |
| F5 MA4 not killed by A-T6 | ADDRESSED | A-T6 asserts the exact op list; A-T7 asserts no `data-default` on an unchanged key; MA4 now names the exact-op assertion |
| F6 화면 mode gates | ADDRESSED | S3a scope and step 5 list the gates; A4; A-T5 widened to a mode x inlay table; mutant MA10 |
| F7 B-T5 reload | ADDRESSED | B-T5 builds a fresh service over the same store double before Undo |
| F8 smaller items | ADDRESSED | plain copies (S3b Writer and Model, B-T1 clone assertion, MB18); `portraitSet` ranked and treated as a row write in `orderAssetWrites` and the folder trigger (S3b Paths, I9); segment counts (S3a step 5, keys); S3a Opus routing recorded as a routing decision (Gate 2 section); Expected files name `StudioForms.svelte.test.ts` and `StudioCharacterForm.formControlNames.svelte.test.ts` |
| MC-4134 (brief) | BUILT IN | S3a step 7; A3b; A-T15; MA9 |

Designer notes:

- The brief calls the MC-4135 test a reproducer. Under F4 and `.claude/rules/tests.md` it cannot be one: BASE-C has no Add, so it fails only on absence. It is classed as an acceptance test, and mutants MC6..MC9 falsify it.
- The portrait add also checks the visit, applying MC-4135 by analogy (S3b Mid-await guard). The reason is the same premise: after a close the service guard alone would let the step land unseen.

## Requirements and scope

Sources: MC-4130..4135 (`Agents/mc/681.md`), MC-4030, MC-3900, MC-1185, MC-1200, MC-1203, MC-1206, MC-1215, MC-1700, MC-1701, MC-1827, MC-1833, MC-350, SLICE4_SPEC sections 3, 5, 7, 12, 13, 16, 17, DD-100, DD-171, DD-177, DD-179, DD-180, DD-191, DD-196.

S3a in scope:
- Name field in Basic (an empty name reverts on blur, spec 3).
- Display form with segments 사진 / 화면 / 에셋, remembered per owner on this device. Counts appear in the 사진 and 에셋 labels (spec 5).
- 사진 holds the `hideChatIcon` and `largePortrait` switches. `largePortrait` shows only while `image` is a non-empty string (classic `CharConfigPanel.svelte:544`).
- 화면, with classic's mode gates (`CharConfigPanel.svelte:580-672`):
  - the mode select always;
  - under `viewScreen === 'emotion'`: the emotion heading and help line (`emotionImage`, `emotionWarn`), the emotion list, the emotion instructions only while inlay is on (`:639`), and the inlay switch (`:644`);
  - under `viewScreen === 'imggen'`: the image-generation heading and help line (`imageGeneration`, `emotionWarn`), the three image-generation texts (`:656-665`) and the inlay switch (`:667`);
  - under `none`: the select only, with no inlay switch, no image-generation texts and no emotion instructions;
  - the fill note, default tag and reset (DD-177, DD-180).
- 에셋: `prebuiltAssetCommand` and `prebuiltAssetStyle`, only with `db.newImageHandlingBeta` (`:675-683`), then the existing asset list.
- `studioHistoryNone` is reworded.
- MC-4134: the inlay switch writes no `additionalAssets`.

S3a not in scope: portrait tiles and Add (S3b), real Add for assets and emotions (S3c), the group form (S8), token chips on the Display texts, the field catalogue, any change to `prebuiltAssetExclude` (stays as built).

Moved from S3c to S3a (designer choice): gating the emotion list by `viewScreen`. S3a places the list inside the 화면 segment, and an ungated list there would contradict spec 5.2 and classic. The gate is one condition beside the placement.

S3b in scope:
- Main tile with 바꾸기 / 삭제; empty state with 사진 추가 and its note; alternates with 대표로 쓰기 / 삭제.
- Delete toasts with Undo (MC-1215, DD-100).
- PNG text chunks copied inside the step (MC-4133).
- History panel lines and the portrait gone-file notice.
- The picker port, used here for a single portrait pick.

S3b not in scope:
- Crop and reorder of alternates (classic has neither).
- History focus into a portrait tile: portrait steps take the panel's fallback focus.
- A portrait count in the tree: `ownerModel.ts:376` counts emotions and assets only, and stays unchanged.

S3c in scope:
- The real `FolderAwarePicker` for the character asset list, and an Add for the emotion list (multi-select).
- Classic file types and size limit, a per-file result report, store-failure retry or drop, busy entries.
- MC-4135: an import lands only within the Studio visit it started in; otherwise the not-added toast.

S3c not in scope:
- Module asset Add (`StudioModuleAssetForm`): the classic module editor is a separate form. Follow-up candidate, not a #681 requirement.
- Emotion reorder: the spec 7.2 row reorder is in neither classic nor MC-4030.
- The mockup's simulated picker.
- The spec's "View in Studio" report after Studio closes. MC-4135 replaces it with the not-added toast.

## Approach and stages

### S7-0 collision anchors (re-read after #685 S7-0 merges)

S7-0 edits `fieldRegistry.ts`, `historyModel.ts`, `ownerHistory.svelte.ts` and `studioSetters.ts`. Its branch had no visible changes when read (worktree `685-s7-0-5d3d39` at 2099bea7a).

Anchors that may move:
- `fieldRegistry.ts`: the `FIELD_SPECS` tail and `FIELD_PRESENTATION` tail (`:68-176`, `:188-287`); `CONTAINER_SEEDS` and its `satisfies` (`:180-184`).
- `historyModel.ts`:
  - the `Op`/`AssetOp`/`StepLabel` unions (`:144-189`), `parseLabel` (`:319-369`), `isOpAllowedFor` (`:375-392`), `parseAssetOp` (`:431-473`);
  - `LiveReader`/`WriteOp`/`Working`/`makeWorking` (`:687-849`), `invertOp` (`:851-877`), `assetPathsReplayMayInsert` (`:886-899`), `assetStepWrites` (`:1074-1089`), `applyForward`/`holdsResultOf` (`:1111-1235`);
  - the gone-row branches of `planReplay` (`:1571-1578`) and `planRevert` (`:2042-2046`);
  - `TargetKey`/`targetKeyText`/`targetKeyOf`/`snapshotOf` (`:1799-1840`), the net-zero drop (`:2110-2127`), `revertStepOps` (`:2251-2300`), `TEXT_FIELD_PATHS` (`:88-116`).
- `ownerHistory.svelte.ts`: the `StudioResult` notes (`:140-159`), the `OwnerHistoryService` interface (`:263-311`), `goneNameOf` (`:865-867`), `unconfirmedInsert` (`:871-886`), `planFor` and its unchanged branch (`:888-1071`), `replayNotes` (`:1073-1101`), the service object (`:1542-1568`).
- `studioSetters.ts`: `resolveLiveTarget` (`:98-137`), `createLiveReader` (`:186-213`), `rowsOfList` (`:216-221`), `editCharacterRows` (`:526-542`), `applyCharacterWrites` (`:555-622`).

If S7-0 adds op kinds, every exhaustive switch that S3b extends gains its case too; the coder merges both.

### S3a: name and Display leftovers

History-core files: `fieldRegistry.ts` YES; `historyModel.ts` YES (router list only); `ownerHistory.svelte.ts` YES (one service method); `studioSetters.ts` NO.

1. `fieldRegistry.ts` `FIELD_SPECS`, appended in this order (frozen once merged):
   - `name: { value: 'text', holders: ['character'], absent: 'keep', editWhenAbsent: false }` (required string, `database.svelte.ts:1465`).
   - `viewScreen: { value: 'text', holders: ['character'], absent: 'keep', editWhenAbsent: false }` (required, `:1473`; the select writes only the three literals).
   - `largePortrait` and `inlayViewScreen`: `{ value: 'bool', holders: ['character'], absent: 'delete', editWhenAbsent: true }` (`:1582`, `:1584`).
   - `prebuiltAssetCommand: { value: 'bool', holders: ['character'], absent: 'delete', editWhenAbsent: true, keepForeign: true }`. Card import writes `''` (`characterCards.ts:1827`).
   - `prebuiltAssetStyle: { value: 'text', holders: ['character'], absent: 'delete', editWhenAbsent: true }`. Import writes the string `''` (`:1829`).
   - `'newGenData.prompt' | '.negative' | '.instructions' | '.emotionInstructions'`: `{ value: 'text', holders: ['character'], absent: 'delete', editWhenAbsent: true }`.
     - Unlike `depth_prompt.prompt` (keep/false), these keys must be fillable on an imported container that lacks one: `newGenData` comes raw from a card (`characterCards.ts:1818`).
     - An undo must remove such a key again. keep/false would refuse the whole mode switch there.
   - `CONTAINER_SEEDS.newGenData = { prompt: '', negative: '', instructions: '', emotionInstructions: '' }`. The `satisfies` key union gains `'newGenData'` (type at `database.svelte.ts:1479-1484`).
   - `FIELD_PRESENTATION`:
     - Labels reuse `name`, `viewScreen`, `largePortrait`, `inlayViewScreen`, `insertAssetPrompt`, `assetStyle`, `imgGenPrompt`, `imgGenNegatives`, `imgGenInstructions` and `emotionInstructions` (all present in `en.ts`).
     - Focus targets: `{ form: 'studio-character-form', part: 'studio-form-name' }` for `name`, and `{ form: 'studio-display-form', part: 'studio-display-<field>' }` for the others.
     - `hideChatIcon` moves to `{ form: 'studio-display-form', part: 'studio-display-hide-icon' }` (MC-4131; presentation only, not frozen).
2. `historyModel.ts` `TextFieldPath` and `TEXT_FIELD_PATHS`: append the four `newGenData.*` paths.
   - A stored merge `textEdit` on `newGenData/<key>` now routes to a `set` of the field, as S1 did for `depth_prompt/prompt` (MC-3941). Landed text is unchanged.
   - A revert written by S3a stores the net `set`, which older builds refuse whole (accepted widening, MC-1827).
3. New `src/ts/studio/edit/screenModeFill.ts` (pure):
   - `buildScreenModeSwitch(change: { viewScreen: 'none'|'emotion'|'imggen' } | { inlay: boolean }, live: LiveReader): EditBuildResult` builds one step. It holds the `set` of `viewScreen` or `inlayViewScreen`, then one `set` for each `newGenData.*` key whose live reading differs from the classic result.
   - The classic result comes from running `updateInlayScreen` on a three-field plain copy, with the new mode applied.
   - "Differs" (F5): the live reading is `{ had: false }`, or `{ had: true, value: v }` with `v` not equal to the classic string. A key whose live reading already equals the classic string gets no op.
   - Label `{ kind: 'field', field: 'viewScreen' | 'inlayViewScreen' }`, `coalesceKey: null`.
   - Also `modeDefaultOf(path, viewScreen, inlay)` for the tag and reset.
   - `src/ts/process/inlayScreen.ts` `updateInlayScreen`: widen the parameter to a generic `T extends Pick<character, 'viewScreen' | 'inlayViewScreen' | 'newGenData'>` returning `T`. This is type-only: the body and the classic callers are unchanged, and the copy needs no cast.
4. `ownerHistory.svelte.ts`: the interface and service gain `screenMode(owner, change)` = `applyStudioWrite(owner, { kind: 'edit', build: (_id, live) => buildScreenModeSwitch(change, live) })`, following the pattern of `greetingAdd` (`:1542`).
5. UI.
   - `StudioCharacterForm.svelte`:
     - The name input comes first (`data-part="studio-form-name"`), with the composition gate of `StudioModuleAdvancedForm.svelte:90-106`.
     - A value that is empty after trim is never written. Blur with an empty input puts the live name back and shows `studioFormNameEmpty` in a `studio-field-note`.
     - The hide-icon checkbox (`:152-163`) and `onHideIconChange` leave the form.
   - New `StudioDisplayForm.svelte` (`data-part="studio-display-form"`, the root of the three segments):
     - a `studio-segments` tablist and `studio-segment` tabs with roving focus;
     - `studio-form-section-body` panels, `hidden` when not shown, with `data-seg="photo|screen|assets"`;
     - tab labels `studioDisplaySegPhoto(n)` (n = 1 for a non-empty `image` + `ccAssets` length when it is an array) and `studioDisplaySegAssets(n)` (n = `additionalAssets` length, 0 when absent); `studioDisplaySegScreen` carries no count (spec 5 "counts in the labels"; 화면 holds no single list).
   - New `StudioDisplayScreen.svelte` (the 화면 panel) renders exactly the gates listed under scope.
   - New `src/ts/studio/displaySegment.ts` keeps the segment per owner in localStorage (the `presetSections.ts` pattern, DD-099: never in the database or a backup).
   - `registerFieldReveal` (`historyFocus.ts:95`) selects the segment holding a path, so history focus reaches hidden fields.
   - `StudioDetail.svelte:266-271`: the display branch mounts `StudioDisplayForm`, keyed by owner as now. That form mounts `StudioAssetList` in 에셋 and `StudioEmotionList` in 화면 under `viewScreen === 'emotion'`.
6. Fill tag and reset (DD-177, DD-180):
   - After `screenMode` lands, the form keeps in memory, per owner visit, the set of paths the step filled and the `(viewScreen, inlay)` pair it filled them for.
   - A filled path shows `data-default` and the tag `studioDefaultTag` while its live value equals `modeDefaultOf`. A path the step did not write never shows `data-default`.
   - The reset button `studioDefaultReset` shows for every filled path while the live pair equals the recorded pair; it stays after an edit (DD-180). It writes the default as one `editText(..., 'single')` step.
   - The note `studioScreenFilled` shows under the select while the set is non-empty. A fill of `newGenData.emotionInstructions` while inlay is off announces `studioScreenFillHidden`.
   - A history undo that changes the pair hides the tag, the reset and the note.
   - Nothing of this is stored.
7. MC-4134: the inlay switch calls `screenMode(owner, { inlay })` only. It does not replicate classic's `additionalAssets` normalisation (`CharConfigPanel.svelte:646-651`). The step's ops touch only `inlayViewScreen` and `newGenData.*`, and no unrecorded write runs beside it. A deliberate, recorded difference from classic under MC-4030.

### S3b: portrait

History-core files: `fieldRegistry.ts` NO; `historyModel.ts`, `ownerHistory.svelte.ts` and `studioSetters.ts` YES. Also `retainedPaths.ts` and `assetSetters.ts`.

Data contract (new persisted op kind, character owners only):

```
type PortraitRow = { type: string; uri: string; name: string; ext: string }        // exactly these keys, all strings
type PortraitValue = { image: { had: false } | { had: true; value: string };
                       alternates: { had: false } | { had: true; rows: PortraitRow[] } }
type ExifValue = { had: false } | { had: true; value: JsonValue }                 // extentions.pngExif, any JSON
{ op: 'portraitSet'; before: PortraitValue; after: PortraitValue; pngExif?: { before: ExifValue; after: ExifValue } }
```

- `pngExif` is present only on an add or replace step that changes it (MC-4133: inside the same step).
- Labels: `{ kind: 'portraitAdd' }`, `{ kind: 'portraitRemove' }`, `{ kind: 'portraitMain' }` (exact keys, `hasOnlyKeys(['kind'])`).

Builders (new `src/ts/studio/edit/portraitSetters.ts`, pure, `AssetBuildResult`). Each mirrors classic exactly:
- Add / 바꾸기 (DD-171, DD-179) = `selectCharImg` + `dumpCharImage` (`characters.ts:262-268, :275-289`):
  - A non-empty old main is appended as `{ type: 'icon', name: 'iconx', uri: old, ext: 'png' }`; the alternates array is created when absent.
  - `image` becomes the new path.
  - `pngExif` after = the before object with the picked chunks assigned over it (classic assigns key by key, `:249-251`). This happens only when the picked file gave chunks and the before value is absent or a plain object; otherwise there is no exif change.
- Make main i = `changeCharImage` (`:291-298`): remove row i, dump the old main if non-empty, and set `image` to row i's `uri`.
- Remove main = classic `:470-473`: `image = ''`, then `changeCharImage(0)` when the alternates are non-empty.
- Remove alternate i = `ccAssets.splice(i, 1)` (`:503`).
- A live reading that is unreadable refuses `precondition`: a non-string `image`, or `ccAssets` that is not an array of exact four-string-key rows. Studio never edits such data.

Model (`historyModel.ts`):
- Parse is strict: exact keys, strings, and `JsonValue` for exif via `toPlainJson`.
- `isOpAllowedFor` allows the op on character owners only.
- `invertOp` swaps `before`/`after` and the exif pair.
- `applyForward` precondition: the live portrait deep-equals `before` and, when present, the live exif equals `before` (`sameJsonValue`).
- `holdsResultOf`: the live value equals `after`.
- `assetStepWrites` passes the op through, and `WriteOp` includes it (the op is its own write, as asset ops are).
- `LiveReader` gains optional `portrait()` and `pngExif()`, and `Working` caches them.
- The record stays v2 (MC-1827 widening). An older parser returns null for the unknown op (`parseOpShape` default `:524-525`), so the whole record is refused and set aside, never overwritten.
- Revert chains (F1):
  - `TargetKey` gains `{ kind: 'portrait' }`; `targetKeyText` gives `'portrait'`, and `targetKeyOf(portraitSet)` returns it.
  - `snapshotOf({ kind: 'portrait' })` = `JSON.stringify({ image: working.portrait().image, alternates: working.portrait().alternates, pngExif: working.pngExif() })`, all three read through the Working copy.
  - The net-zero drop (`:2110-2127`) and `revertStepOps` (`:2286`) therefore drop the portrait chain only when the image, the alternates and the exif all end where they started.
  - Nothing outside `portraitSet` writes `extentions.pngExif` in Studio, so one target key covers both.
- `planReplay` / `planRevert` gone branch: a forward `portraitSet` that puts back a path in `goneRows` is skipped, and the path joins `goneSeen` (the step is dropped as for a gone row, MC-1700). Nothing partial is written for the portrait.
- Each gone path also records its source kind, `'row'` or `'portrait'` (`'row'` wins when both name it). The plan result carries `gonePortrait: true` when `goneRows[0]` (sorted) came only from `portraitSet` ops.

Paths: `portraitPaths(value)` = the `image` value and every row `uri`. "Removed by the forward op" = in `before`, not in `after`. "Put back" = in `after`, not in `before`.
- `retainedPaths.ts` `stepPathsOf`: a `portraitSet` names its symmetric difference, stored-asset paths only (`isStoredAssetPath`), so a non-store string is never copied into the retained field. The name is the row `name` when the path is an alternate on either side, else `''`.
- `assetSetters.ts`:
  - `removesAssetRow` is true for a `portraitSet` with a removed stored path. This makes the removal refusals (MC-1185/1200) and the immediate save (`ownerHistory.svelte.ts:1257-1258`) apply.
  - `touchesAssets` is true for every `portraitSet` (retained recompute `:1191-1232`).
  - `orderAssetWrites` (`:354-358`) ranks `portraitSet` 0, with the rows.
- `studioSetters.ts` `applyCharacterWrites`: the folder-write trigger condition (`:563`) lists `portraitSet` beside the three row ops. The folder document is then written after it, never before (F8; harmless today because the folder is `keep`, but kept as the stated order).
- `historyModel.ts` `assetPathsReplayMayInsert` and `ownerHistory.svelte.ts` `unconfirmedInsert` include the put-back stored paths: the file probe runs before replay (MC-1700, MC-1702, MC-1833).

Gone-file notice (F3):
- `StudioResult` / `StudioWriteNotes` gain `goneKind?: 'portrait'`. `replayNotes` sets it from the plan's `gonePortrait`, and so does the `unchanged` branch of `planFor` (`:1032-1043`).
- New exported `goneFileText(result: { goneRows?: string[]; goneName?: string; goneKind?: 'portrait' }): string | null` in `studioToasts.ts`. It returns `language.studioPortraitFileGone` when `goneKind === 'portrait'`, else `language.studioAssetFileGone(result.goneName ?? result.goneRows[0])`, and null when no row is gone.
- All three render sites call it: `studioToasts.ts` (asset toast Undo, `:219-221`), `StudioHistoryPanel.svelte:188` and `StudioScreen.svelte:193`.

Writer (`studioSetters.ts`):
- `createLiveReader` gains `portrait()` and `pngExif()`. Both return plain copies: rows are copied field by field, and exif goes through `toPlainJson`. No Svelte `$state` proxy reaches an op or the store's structured clone (F8).
- `applyCharacterWrites` case `portraitSet`:
  - `image` is set or deleted;
  - `ccAssets` is replaced by fresh plain row copies or deleted;
  - `extentions.pngExif` is set (creating `extentions` only then) or deleted.
  - No other key changes.

Service (`ownerHistory.svelte.ts`): `portraitAdd(owner, path, chunks)`, `portraitMakeMain(owner, index)` and `portraitRemove(owner, target: 'main' | number)`. Each is `applyStudioWrite(owner, { kind: 'asset', build })`, and the stepId is returned for the toast (`:1276`).

Mid-await guard:
- The add flow captures `studioScreen.visitId`, then awaits the picker, the bytes, the chunk read and `saveImage`. It calls `portraitAdd` only while `studioScreen.open` and the visit id is unchanged (the S3c rule, applied by analogy with MC-4135; reason in Summary).
- `applyStudioWrite` then re-resolves the owner (`resolveLiveTarget`, `studioSetters.ts:100-137`). A removed, archived (`coldstorage`), deselected, private or duplicate-id character refuses, with nothing written.
- When the visit ended, the app-wide toast `studioImportNotAdded(1)` is posted. Any other refusal shows its refusal text.
- The saved file is then unreferenced, and the next boot sweep may delete it, as in classic (`characters.ts:262-266`).
- A store failure in `saveImage` writes nothing and shows `studioPortraitStoreFail`.

UI: new `src/lib/Studio/StudioPortraitSection.svelte`, in 사진 above the two switches.
- `studio-portrait-main` (2:3 when `largePortrait`), with a `⋯` menu (`studioPortraitReplace`, `remove`).
- Empty state: `studioPortraitAdd` + `studioPortraitAddNote`.
- `studio-portrait-alt` tiles with a visible name and a `⋯` menu (`studioPortraitMakeMain`, `remove`).
- `studioPngNote(n)` after an add that copied n chunks.
- Toasts go through `postAssetAction` (`studioToasts.ts:144`): `studioPortraitPromoted` when a remove-main promoted an alternate, else `studioPortraitRemoved`.
- History panel lines `studioStepPortraitAdd`, `studioStepPortraitRemove` and `studioStepPortraitMain` (the label switch in `StudioHistoryPanel.svelte`, `:224` region).
- Refusals reuse the `asset-no-undo` / `asset-other-tab-character` texts (MC-1185, MC-1200).

Picker port (shared with S3c):
- New `src/ts/studio/assets/filePicker.ts`: `pickFiles(kind: 'portrait' | 'emotion' | 'asset')` over `selectSingleFileObject`/`selectMultipleFileObjects` (`util.ts:94-108`). It provides:
  - classic extension lists: portrait `characters.ts:210`, emotion `:306`, assets `CharConfigPanel.svelte:693`;
  - an extension re-check after the chooser (the Android chooser is not trusted to filter);
  - the size split `pickedAssetLimitBytes` + `splitByAssetLimit` + `reportRefusedAssets` (classic `:214-218`, `:311-316`);
  - `beginBusy` kinds `charImage` / `charEmotion` / `assetAdd` (`busyActions.ts:25`);
  - per-file results `stored | badType | tooLarge | storeFailed`.
- New `src/ts/studio/assets/portraitTextChunks.ts`: `readPortraitTextChunks(bytes)` with classic's allowlist and 20 000-character cap (`characters.ts:229-255`), PNG only.

### S3c: real Add for assets and emotions

History-core files: `studioSetters.ts` YES; the other three NO (`assetInsert` exists, `ownerHistory.svelte.ts:1567`).

U4 fix:
- U4 is confirmed: `buildAssetInsert` on a character without `additionalAssets` is refused `precondition`. The path is `assetSetters.ts:277-279` via `createLiveReader().assetRows` -> `rowsOfList(undefined)` -> null (`studioSetters.ts:207, :216-218`).
- `createLiveReader.assetRows('additionalAssets')` reads an absent (`undefined`) key as `[]`.
- `editCharacterRows` creates the array on an insert into an absent key (classic `c.additionalAssets ??= []`, `CharConfigPanel.svelte:711`).
- A present non-array value stays unreadable.
- Undo of that insert leaves `[]`. Every reader treats `[]` and absent alike except `{{assetlist}}`, where `[]` is the non-throwing case (`cbs.ts:1438`, `parser.svelte.ts:1486-1493`).

Import job (new `src/lib/Studio/assets/studioImport.svelte.ts`):
- One import job per owner key, held outside the component (DD-191: leaving the item does not cancel it).
- Files are stored one by one: `saveAssetFromBlob(file, ext)` for assets, as classic `:708`; `readPickedFileBytes` + `saveImage` for emotions, as classic `:324-325`.
- Then one `assetInsert` step with every stored row (label `assetAdd`, n rows), then the landing for folders.
- Emotion row name = the file name without its last extension (spec 7.2; classic strips only `.png`/`.webp`, `characters.ts:326`).
- Rows show `studioImporting` while pending.
- A store failure keeps the file in the job with `studioStoreFail`, `studioRetry` and `studioDropRow`, and never inserts a half row.
- The result is announced once with `studioPickResult(n, m)`. Bad types list `studioPickBadType(ext)`; too-large files use the classic report.

Import job and the Studio visit (MC-4135, F2):
- At Add, the job records `visit = studioScreen.visitId`.
- The visit ends when Studio closes or the selection moves away: the watcher at `studioScreen.svelte.ts:155-160` closes Studio, and a new open makes a new `visitId` (`:186-187`). `closeStudio` keeps `chaId` and `visitId` (`:198-201`, `resetVisitState` `:118-140`), so `resolveLiveTarget` alone would still accept an insert after a close with the selection unchanged.
- The job therefore inserts only while `studioScreen.open && studioScreen.visitId === visit`. That check runs immediately before `service.assetInsert`, and again before a retry's insert.
- While a job has entries that have not landed, it holds a `$effect.root` that watches `studioScreen.open` and `studioScreen.visitId`. When the visit ends, the job ends:
  - files still storing finish, because a running save cannot be cancelled;
  - no insert follows;
  - entries waiting on retry are dropped;
  - after the last store settles, one app-wide toast is posted: `toastHost.post({ kind: 'warning', text: language.studioImportNotAdded(n) })`, where n = every accepted file of the job that did not land (stored, or waiting on retry). Bad-type and too-large files were already reported at pick time and are not counted.
  - The stored files are unreferenced; the next boot sweep removes them (MC-4135). The watcher is disposed with the job.
- Any other refusal of the insert (gone, archived, duplicate-id, restricted, precondition, memoryOnly refusals do not apply to an insert) also inserts nothing. It posts the same toast with `sub: refusalText(reason)`.
- Folder landing: `ImportLanding` (`StudioAssetList.svelte:20-26`) gains `alive(): boolean`, which `openPicker` supplies as `() => !unmounted` (the list's existing flag, `:502-503`). The job calls `land(names)` only when the insert landed and `alive()` is true.
  - When the list was left in between (the item changed, the visit stayed), the rows stay in "No folder".
  - On a refused insert, `land` is never called.
- Wiring: `StudioAssetList` gets `picker` from `StudioDisplayForm` (character owner only). `StudioEmotionList` gains an Add button (`data-part="studio-emotion-add"`) and the empty-state Add; emotions have no folders and no landing.

## Expected files

S3a:
- `src/ts/studio/history/fieldRegistry.ts`, `src/ts/studio/history/historyModel.ts`, `src/ts/studio/history/ownerHistory.svelte.ts`.
- New `src/ts/studio/edit/screenModeFill.ts`; `src/ts/process/inlayScreen.ts` (signature only); new `src/ts/studio/displaySegment.ts`.
- `src/lib/Studio/StudioCharacterForm.svelte`, new `src/lib/Studio/StudioDisplayForm.svelte`, new `src/lib/Studio/StudioDisplayScreen.svelte`, `src/lib/Studio/StudioDetail.svelte`.
- `src/lang/en.ts` + 7 locales.
- Tests:
  - `fieldRegistry.frozen.test.ts` (rows, seed, F-g list);
  - `historyModel.s1TextFields.test.ts` (T1-TX (a), (g), (h) membership updates);
  - `src/ts/studio/toggleUpdateAll.test.ts:286`;
  - new `screenModeFill.test.ts`;
  - new `historyModel.s3aRecords.test.ts` + fixture;
  - new `StudioDisplayForm.svelte.test.ts`;
  - `StudioCharacterForm` tests, including `StudioForms.svelte.test.ts` and `StudioCharacterForm.formControlNames.svelte.test.ts`, which hard-code `studio-form-hide-icon` (F8);
  - `StudioDetail.emotionList.svelte.test.ts` (fixtures gain `viewScreen: 'emotion'`);
  - `StudioHistoryFocus.svelte.test.ts` (hide-icon target).

S3b:
- `historyModel.ts`, `retainedPaths.ts`, `src/ts/studio/edit/assetSetters.ts`, `studioSetters.ts`, `ownerHistory.svelte.ts`.
- New `portraitSetters.ts`, new `filePicker.ts`, new `portraitTextChunks.ts`, new `StudioPortraitSection.svelte`.
- `StudioDisplayForm.svelte`, `StudioHistoryPanel.svelte`, `src/lib/Studio/StudioScreen.svelte` (gone-notice site, F3), `src/ts/studio/edit/studioToasts.ts` (`goneFileText` and its use).
- `en.ts` + 7 locales.
- Tests listed below, plus fixture `src/ts/studio/history/tests/fixtures/historyV2.portrait.json` and its generator test.

S3c:
- `studioSetters.ts`, new `studioImport.svelte.ts`, `filePicker.ts` (multi), `StudioAssetList.svelte` (`ImportLanding.alive` only), `StudioEmotionList.svelte`, `StudioDisplayForm.svelte`.
- `en.ts` + 7 locales.
- Tests below.

Not touched in any stage:
- `globalApi.svelte.ts`: the GC keep-set already roots `image`, `ccAssets[*].uri` and the retained pairs (`:2063-2105`).
- `store2/lists/assetList.ts` (`:139-158`).
- Card export and the `.bin` writers.
- `studioScreen.svelte.ts`: read only, no change.
- The `themePack` registries: all new parts are `studio-*`, which `areaParts.ts:62-65` accepts. The spec's portrait and segment parts are already in `S4_SAFE` (`registries/studio.ts:48-50`), and no new critical part is added.

## Invariants and compatibility

- I1 Upstream shapes unchanged (MC-175):
  - Every S3 write is a field that classic writes, in classic's shape: `ccAssets` rows `{type, uri, name, ext}`, `image` a string, `viewScreen` one of three literals, `newGenData` keys strings, and `pngExif` the classic map.
  - `.bin` and card export code is untouched.
  - The retained field (`risutanium_asset_retained`) is the existing fork-only key (engine change #31); portrait paths join it without a new key.
- I2 Older builds and history records (MC-1827, MC-350):
  - A record holding an S3a path, a `newGenData` revert `set` or a `portraitSet` is refused whole by an older build, and set aside with its bytes kept (`studioHistoryStore.ts:67-91`).
  - Accepted consequence, the same class as S1/S2: an Android build downgraded after S3 loses Studio undo for that owner only. The character data is untouched.
  - Records written before S3 parse and replay unchanged (A-T10, B-T9).
- I3 One router: a registry text target is a `set` exactly when its path is in `TEXT_FIELD_PATHS`. T1-TX (b) stays the enforcing test.
- I4 Retention: every stored path that a loaded step can put back is in the owner's retained pairs (ready phase: memory, acknowledged and unsettled saves), so the boot sweep (`getUncleanablesSync`) never deletes it.
- I5 Removal refusals: a write that drops a stored portrait path is refused, with nothing changed:
  - in `memoryOnly` (other tab: `asset-other-tab-character`; otherwise `asset-no-undo`);
  - in `ready`+`unwritable`;
  - with an unreadable retained field (`removalRefusal`, `ownerHistory.svelte.ts:1336-1351`).
- I6 No write without its step: a portrait add copies PNG chunks only inside its step. A refused or failed add changes neither `image`, `ccAssets` nor `pngExif`.
- I7 The MC-1203 crash window (removal written, history save not yet acknowledged) applies to portrait removal unchanged; accepted.
- I8 Presentation only: moving `hideChatIcon` changes no path fact. The hidden emotion list keeps its data, and the segment memory is device-only.
- I9 Revert net-zero: the portrait chain is dropped only when `image`, alternates and `pngExif` all equal their start (F1). `portraitSet` is written before the folder document, with the rows.
- I10 MC-4134: no Studio step and no Studio-side write changes `additionalAssets` on a mode or inlay switch.
- I11 MC-4135: an import inserts only within the Studio visit it started in. Otherwise it inserts no row, writes no step, calls no landing, and posts one app-wide toast with the count.

## Acceptance scenarios

S3a
- A1 Name: typing a new name lands one coalesced step. Blur with an empty field restores the live name and shows the note. The tree row and the detail title show the new name (U1).
- A2 Basic no longer has the hide-icon switch. 사진 has it and `largePortrait` (only with a main image). Undo of each focuses its switch in 사진, switching segment if needed.
- A3 Mode switch:
  - Changing `viewScreen` or inlay fills exactly what classic's `updateInlayScreen` fills and keeps author text.
  - The step's ops are exactly the switch plus the keys whose value changes.
  - It is one undo step that restores all fields.
  - Filled fields show the tag and the reset. The tag goes on edit; the reset stays (DD-180).
- A3b The inlay switch leaves `additionalAssets` as it is: absent stays absent on turn-on, `[]` stays `[]` on turn-off (MC-4134).
- A4 화면 gates per mode:
  - `none`: only the select.
  - `emotion`: the emotion help, list and inlay switch; emotion instructions only with inlay on.
  - `imggen`: the image-generation help, the three texts and the inlay switch; no emotion instructions.
  - The asset list is in 에셋. The beta switches show only with `newImageHandlingBeta`. Segment labels carry counts.
- A5 Old records: an S1-era record and a merge step on `newGenData/prompt` replay to the same text as before S3a.

S3b
- B1 Add/replace: the new photo becomes main, the old main is appended as classic does, PNG chunks are merged into `pngExif`, and it is all one step. Undo restores `image`, `ccAssets` and the previous `pngExif` exactly.
- B2 Make main swaps exactly as `changeCharImage`. Image and alternates stay coherent after undo and redo.
- B3 Remove main promotes the first alternate (the toast says so); remove alternate. Both are durable: after a reload, a boot sweep and Undo, the file is still there and the reference comes back.
- B4 Refusals:
  - other tab / no history / unreadable retained field refuse removals, with nothing changed;
  - a character removed or archived during the pick refuses, with nothing written;
  - Studio closed during the pick: nothing written, and the not-added toast.
- B5 Replay probes put-back files. An unchecked file refuses (MC-1700/1701). A gone file drops the step, and the portrait notice shows in the Studio notice, the history panel and the toast.
- B6 A revert across add -> remove main (promote) on `ccAssets: []` restores the earlier `pngExif` instead of answering "unchanged" (MC-4133, F1).

S3c
- C1 Asset Add on a character with and without `additionalAssets` lands one `assetAdd` step with all stored rows, in the open folder.
- C2 Emotion Add, multi-select: names without the real extension; bad type and too large are reported and the others added; store failure offers retry or drop; nothing is half-added.
- C3 Busy entries cover the store phase.
- C4 Studio closes (or the selection moves away, or Studio is closed and reopened) while files are being stored, or while a failed file waits on retry:
  - no row and no step;
  - the landing is not called;
  - the stored files are referenced nowhere in the character;
  - one app-wide toast with the count of files not added.
  - Leaving the item within the same visit still lands the rows (outside folders when the list is gone).

## Required tests

Pre-fix bases: BASE-A = `origin/main` at the S3a branch point (2099bea7a + #685 S7-0); BASE-B = merged S3a; BASE-C = merged S3b.

Every reproducer is DESIGNED, NOT DEMONSTRATED. "Acceptance (new behaviour)" rows test behaviour that has no pre-fix form. On the base they fail only on absence, which proves nothing (`.claude/rules/tests.md`); the mutants listed below carry their falsification.

Fixtures marked "real producer" are built by the app's own builders, `commitStep` and the store encoder (MC-329). They are committed as JSON with a generator test that rebuilds them and compares (a compatibility guard against drift).

| id | scenario | class | pre-fix base and expected failure | fixture |
|---|---|---|---|---|
| A-T1 | A1 name edit lands, undo restores | acceptance (new behaviour) | n/a (BASE-A lacks the input; falsified by mutants) | character from the existing Studio form rig (`StudioForms.svelte.test.ts` pattern) |
| A-T2 | A1 empty name reverts on blur; the store never holds `''`; note shown | acceptance (new behaviour) | n/a; MA5 | same |
| A-T3 | A1 tree row and title re-derive after the A-T1 edit (U1) | acceptance (new behaviour) | n/a; D-A1 first settles U1 | `StudioScreen` rig with history |
| D-A1 | U1 mechanism: write `name` on the live character, assert the `readOwnerModel` owner name and the title | diagnostic | expected to pass on BASE-A; if it fails, S3a adds the reactive read | same |
| A-T4 | A2 Basic has no `studio-form-hide-icon`; 사진 has `studio-display-hide-icon`, and history focus lands on it | acceptance (new behaviour) | n/a; MA7 | form rig |
| A-T5 | A4 table over `viewScreen` in {none, emotion, imggen} x inlay {off, on}, with 2 emotion images: rows present only under emotion; `studio-display-inlay` present only under emotion and imggen; `studio-display-newGenData.emotionInstructions` only under emotion with inlay on; the three image-generation texts only under imggen; under none only the select; beta switches only with `newImageHandlingBeta`; segment labels show counts (사진 n, 에셋 n) | acceptance (new behaviour) | n/a; MA6, MA10 | character with `emotionImages`, `ccAssets`, `additionalAssets` |
| A-T6 | A3 table: (none->emotion, inlay off/on), (emotion->imggen), (imggen->none), a field with author text, a container lacking `negative`, an absent `newGenData`, and a key already equal to the classic result. Asserts: the result after `screenMode` equals `updateInlayScreen(structuredClone(char))` on the four keys and `viewScreen`; the step's op list is exactly `[switch set, then a set for each key whose live reading differs from the classic string]` (paths and before/after compared exactly); one step; undo returns the character deep-equal to the original (a missing key is removed, an absent container is read as seed) | acceptance (new behaviour) | n/a; MA2, MA3, MA4 | characters built by `applyCharacterDefaults`, then field overrides |
| A-T7 | A3 tag/reset: a filled field has `data-default`; a key the step did not change has no `data-default`; typing removes the tag and the reset stays; reset is one step writing the default; history undo of the switch hides tag and reset | acceptance (new behaviour) | n/a; MA8 | same |
| A-T8 | registry facts: ten new frozen rows, seed `newGenData`, F-g lists `prebuiltAssetCommand` | compatibility guard (frozen-facts guard whose expectation this PR extends; pins the rows against later edits) | n/a | `fieldRegistry.frozen.test.ts` |
| A-T9 | router: the T1-TX (a) list gains the four paths; (b) passes; (g) `textFieldOf('newGenData/prompt') === 'newGenData.prompt'`; (h) `textWriteFor` gives a `set` | compatibility guard (T1-TX (b) is the enforcing guard; it fails when a mutant drops a path) | n/a | existing test file |
| A-T10 | A5 CX: `historyV2.b0.json` (existing real-producer fixture) parses and replays as before; a merge step built by `buildAssetMerge` with a `textEdit` on `newGenData/prompt` undoes, redoes and reverts to the same landed text on BASE-A and after | compatibility guard (passes before and after) | n/a | real producer: `buildAssetMerge` + `commitStep` + store encoder |
| A-T11 | the restore point learns a merged `newGenData` text, and restore puts it back | regression reproducer | BASE-A: `newGenData.prompt` is not a restore path; the restored-value assertion fails | real producer merge step |
| A-T12 | records with S3a rows written by the real builders parse and replay (fixture `historyV2.s3a.json`) | regression reproducer | BASE-A: `parseOwnerRecord` returns null; `not.toBeNull()` fails | real producer, committed JSON |
| A-T13 | segment remembered per owner across remount; storage that throws means 사진 | acceptance (new behaviour) | n/a; MA11 | localStorage stub |
| A-T14 | localeParity for the new keys | compatibility guard | n/a | existing test |
| A-T15 | A3b MC-4134: inlay turn-on with `additionalAssets` absent leaves `'additionalAssets' in char` false; turn-off with `[]` leaves `[]`; the landed step's ops name only `inlayViewScreen` and `newGenData.*` paths | compatibility guard (invariant guard; on BASE-A it fails only because the switch is absent, which proves nothing; MA9 falsifies it) | n/a | defaults-built character, `viewScreen: 'emotion'` |
| B-T1 | B1 add with an old main and a PNG carrying two allowed tEXt chunks, one disallowed and one over 20 000 chars: `image`, `ccAssets` and `pngExif` equal what classic `selectCharImg` produces on a clone; one step; `structuredClone(step.ops)` succeeds while the live character is a `$state` proxy (F8) | acceptance (new behaviour) | n/a; MB14, MB18 | PNG built by the app's `PngChunk` writer (`pngChunk.ts:52`) |
| B-T2 | B1 undo of add restores the previous `pngExif` (absent, and an existing map), `image`, and `ccAssets` absent when it was absent | acceptance (new behaviour) | n/a; MB6, MB11 | same |
| B-T3 | B2 make main i equals `changeCharImage` on a clone; undo and redo keep `image` and every alternate `uri` a bijection with the files before | acceptance (new behaviour) | n/a; MB12 | character with 2 alternates |
| B-T4 | B3 remove main with alternates promotes row 0 and posts the promoted toast; without alternates it leaves `image: ''` | acceptance (new behaviour) | n/a | same |
| B-T5 | B3 durable across a reload: remove main through service S1 and save (ready); build a fresh service S2 over the same store double and database (F7); run `getUncleanablesSync` on the database, and the removed path is in the keep-set; Undo through S2 restores the reference, and the file probe was answered present | regression reproducer for the retention rule on a mutant base: with MB1 or MB3 applied the keep-set assertion fails; on BASE-B it fails only on absence | MB1/MB3 base: keep-set lacks the path | real service + memory store doubles (`studioStoreDoubles`) |
| B-T6 | B4 refusals: memoryOnly other tab, memoryOnly, unwritable, unreadable retained: remove is refused with the right refusal, and the character and record are unchanged; add is not refused in memoryOnly | acceptance (new behaviour) | n/a; MB2 | service rig phases |
| B-T7 | B4 mid-await: the character is archived, removed or deselected after `saveImage` resolves -> refused, nothing written, no step; Studio closed (same selection) during the pick -> no step, one `studioImportNotAdded(1)` toast | acceptance (new behaviour) | n/a; MB15, MC6 (shared visit check) | picker port mock resolving after a DB or `studioScreen` change |
| B-T8 | B5 replay: undo of a remove asks the file reader for the put-back path; unanswered -> `asset-file-unchecked`; gone -> step dropped, `goneRows` named, `goneKind === 'portrait'` | acceptance (new behaviour) | n/a; MB4, MB5, MB13 | real producer fixture |
| B-T9 | parse: committed `historyV2.portrait.json` (three labels, exif pair present and absent) parses to the same ops; a variant with an extra row key, a non-string `uri`, a `portraitSet` on a module or chat owner, or an unknown label key is refused whole; `historyV2.b0.json` still parses | acceptance (new record shape; first part) and compatibility guard (b0 part, passes before and after) | n/a; MB9, MB10 | real producer, committed |
| B-T10 | invert, precondition, holds-result, revert chain: (a) undo after a classic-side edit of `ccAssets` refuses `precondition`; (b) an already-in-place undo moves the step; (c) a revert across add, make-main and remove restores the first value and stores the net chain; (d) F1: start {image M, ccAssets []}, pngExif E0; add N with chunks (pngExif E1); remove main (promotes M: {M, []}); revert to the step before the add -> the result is not `unchanged`, `pngExif` deep-equals E0, `image` M, `ccAssets` [], and the stored step holds the portrait chain | acceptance (new behaviour) | n/a; MB7, MB8, MB16 | real producer; (d) character from the card-import shape (`ccAssets: []`, as `characterCards.ts:1728-1733`) |
| B-T11 | retention helpers: `stepPathPairs` of each portrait step = its stored symmetric difference; `removesAssetRow` true only for remove; `touchesAssets` true for all | acceptance (new behaviour) | n/a; MB1, MB2, MB3 | committed fixture |
| B-T12 | `readPortraitTextChunks` allowlist, cap; a non-PNG gives none | acceptance (new helper unit test; behaviour pinned against classic's list) | n/a | `PngChunk`-written PNG |
| B-T13 | localeParity | compatibility guard | n/a | existing |
| B-T14 | F3: a gone main portrait path shows `studioPortraitFileGone` (no path text) in (1) the Studio notice after Ctrl+Z (`StudioScreen.svelte`), (2) the history panel after Undo, and (3) the asset toast's Undo outcome; a gone asset row still shows `studioAssetFileGone(name)` in all three | acceptance (new behaviour) and compatibility guard (row part, passes before and after) | n/a; MB17 | `StudioScreen.history.svelte.test.ts` rig with `files.states` gone |
| C-T1 | C1 U4: `assetInsert` through the service on a character without `additionalAssets` lands; undo leaves `[]` | regression reproducer | BASE-C: the service returns `{ ok: false, reason: 'precondition' }`; `expect(result.ok).toBe(true)` fails | character built by defaults with the key deleted |
| C-T2 | C1 picker flow: Add in 에셋 with a folder focused: one `assetAdd` step with n rows, then the folder move | acceptance (new behaviour) | n/a; MC4 | `selectMultipleFileObjects` mocked to return `File`s |
| C-T3 | C2 emotion Add: `photo.gif` -> name `photo`; `.bmp` refused with its reason; an over-limit file reported by the classic report; the others added; one announcement | acceptance (new behaviour) | n/a; MC2, MC3 | mocked chooser, `pickedAssetLimitBytes` mocked |
| C-T4 | C2 store failure on file 2 of 3: rows 1 and 3 land; file 2 waits with retry/drop; retry lands it as a second step; drop removes it; no half row | acceptance (new behaviour) | n/a | `saveAssetFromBlob` mock throwing once |
| C-T5 | C3 the busy entry exists during the store phase and ends after, also on throw | acceptance (new behaviour) | n/a; MC5 | `busyActions` snapshot |
| C-T6 | existing asset and emotion list suites | compatibility guard (pass before and after) | n/a | existing |
| C-T7 | localeParity (includes `studioImportNotAdded`) | compatibility guard | n/a | existing |
| C-T8 | C4 MC-4135, asset and emotion jobs, with `saveAssetFromBlob` / `saveImage` held on a deferred promise. (a) `closeStudio()` with the selection unchanged. (b) The selection moves to another character (Studio closes through its watcher). (c) Close and `openStudio` on the same character (new visit). Each then resolves the store and asserts: `additionalAssets` / `emotionImages` deep-equal to before; no new step in the owner's record; the landing's `land` spy not called; `toastHost` received exactly one plain post with `studioImportNotAdded(2)`; the stored paths are named nowhere in `image`, `ccAssets`, `additionalAssets`, `emotionImages` or the retained field. (d) Control: the list unmounts (the item changes) but the visit stays: one step lands with 2 rows, `land` is not called, rows are in "No folder", and no not-added toast | acceptance (new behaviour; the brief names it a reproducer, but BASE-C has no Add, so per F4 it is falsified by MC6..MC8) | n/a; MC6, MC7, MC8 | Studio rig with `openStudio` (watchers installed), deferred store mocks, `resetToastHostForTests` |
| C-T9 | C4 waiting entry: file 2 of 3 fails (rows 1 and 3 land), then `closeStudio()`: the waiting entry is dropped; one `studioImportNotAdded(1)` toast; a retry is no longer offered after reopening | acceptance (new behaviour) | n/a; MC9 | as C-T4 plus `closeStudio` |

jsdom: every Svelte test above runs under the existing Studio test environment. None asserts sanitised markup, so MC-239 identity-sanitizer falsification does not apply.

## Mutants to kill

Each mutant breaks one new rule, and the named test must fail. The S3b list is for the S3b Gate 2 run.

S3a
- MA1 drop one `newGenData.*` path from `TEXT_FIELD_PATHS` -> A-T9 (T1-TX (b)).
- MA2 `newGenData.*` facts `absent: 'keep'` -> A-T6 (container lacking `negative`: undo leaves the key).
- MA3 seed `newGenData.prompt: 'best quality, {{slot}}'` -> A-T8 (F-f) and A-T6.
- MA4 `buildScreenModeSwitch` skips the comparison and writes all four keys -> A-T6 (exact op list: the case with a key already equal to the classic result gains an op).
- MA5 the name commit writes `''` -> A-T2.
- MA6 the emotion list gate is removed -> A-T5.
- MA7 `hideChatIcon` focus part left at `studio-form-hide-icon` -> A-T4.
- MA8 the tag is shown when the value differs from the default -> A-T7.
- MA9 the inlay switch handler also runs classic's `additionalAssets` normalisation on the live character -> A-T15.
- MA10 the inlay switch is shown under `viewScreen === 'none'` (or the image-generation texts outside imggen) -> A-T5.
- MA11 the segment is stored globally instead of per owner -> A-T13.

S3b
- MB1 `stepPathsOf` ignores `portraitSet` -> B-T5 (keep-set), B-T11.
- MB2 `removesAssetRow` ignores `portraitSet` -> B-T6 (memoryOnly remove lands).
- MB3 `touchesAssets` ignores `portraitSet` -> B-T5 (retained not recomputed).
- MB4 `assetPathsReplayMayInsert` ignores `portraitSet` -> B-T8 (reader not asked).
- MB5 `unconfirmedInsert` ignores `portraitSet` -> B-T8 (unanswered probe lands).
- MB6 `invertOp` keeps the exif pair unswapped -> B-T2.
- MB7 the `applyForward` precondition compares `image` only -> B-T10 (a).
- MB8 `holdsResultOf` always false -> B-T10 (b).
- MB9 the parser accepts a row with an extra key -> B-T9.
- MB10 `isOpAllowedFor` allows `portraitSet` for a module -> B-T9.
- MB11 the writer writes `ccAssets: []` for `{ had: false }` -> B-T2.
- MB12 the make-main builder keeps the promoted row's own metadata for the dumped main -> B-T3.
- MB13 the gone-path skip is removed in `planReplay` -> B-T8.
- MB14 the add builder replaces `pngExif` instead of assigning over it -> B-T1.
- MB15 add builds from a reader captured before the await -> B-T7.
- MB16 the portrait snapshot omits `pngExif` (`{ image, alternates }` only) -> B-T10 (d) (the revert answers `unchanged`, and E1 stays).
- MB17 `goneFileText` ignores `goneKind` (or one site keeps the direct `studioAssetFileGone` call) -> B-T14.
- MB18 `pngExif()` on the live reader returns the live value without `toPlainJson` -> B-T1 (`structuredClone` throws on the proxy).

S3c
- MC1 an absent `additionalAssets` reads null again -> C-T1.
- MC2 the extension re-check is removed -> C-T3.
- MC3 the emotion name strips `.png`/`.webp` only -> C-T3.
- MC4 an insert per file instead of one step -> C-T2 (step count).
- MC5 `beginBusy` omitted -> C-T5.
- MC6 the visit check before the insert is removed (the job relies on `resolveLiveTarget` only) -> C-T8 (a) and (c): rows land after the close.
- MC7 the not-added toast is not posted -> C-T8 (a), (b) and (c).
- MC8 the landing is called without `alive()` (or after a refused insert) -> C-T8 (d) and (a): the `land` spy is called.
- MC9 n counts stored files only and drops the waiting entries from the count -> C-T9 (toast count 0 or missing instead of 1).

Not killable by a test (stated): placing the folder write before `portraitSet` in `applyCharacterWrites` has no observable effect while the folder op is `keep`. I9 is enforced by review of the order, not by a mutant.

## Gate 2, coders, devices

- S3a: Gate 2 opus-reviewer.
  - Routing decision for the Orchestrator to record (F8). This raises the review above the Sonnet Gate 2 named in MC-4130 under the critical-contract rule. It is not a change to MC-4130.
  - Changed contract: history replay routing of stored merge `textEdit`s on `newGenData/*` (now a field `set`), and a new persisted container seed.
  - Failure scenario: an old merge step replays to a different text or is refused, or a seed reading replays a value other than `''`.
  - Coder: Sonnet.
- S3b: Gate 2 opus-reviewer.
  - Changed contracts: the Studio history record (new op kind and labels, revert snapshot), asset retention / GC roots, the asset add/remove lifecycle, and the replay file probe.
  - Failure scenarios:
    - Undo of a portrait removal after a reboot restores a reference to a file the sweep deleted.
    - Undo or revert of an add leaves the copied `pngExif`.
    - A swap leaves `image` and `ccAssets` naming a file twice or losing one.
    - A removal lands while history cannot be kept.
  - Coder: Opus.
- S3c: Gate 2 Sonnet reviewer.
  - Named contracts: an insert into an absent `additionalAssets` creates it and nothing else changes in the replay of existing steps; an import inserts only within its Studio visit (MC-4135).
  - If the coder needs any change in `historyModel.ts` or `ownerHistory.svelte.ts`, the Orchestrator raises the review to opus-reviewer.
  - Coder: Sonnet.
- Locales: every stage's en keys go to the translator role for the 7 locales in the same PR, and localeParity runs before push.
- Device rows (Note 9, synthetic data only; mocks cannot prove the real Android chooser, the real store and the boot sweep):
  - DV-B1: the real chooser picks a synthetic PNG with tEXt chunks -> it becomes main, with the old main in alternates; Undo; Redo; remove main; force-stop and relaunch (the boot sweep runs); Undo restores the portrait, and it renders.
  - DV-C1: a real chooser multi-pick of 3 files including a `.bmp`, for emotions and for assets -> 2 added per list and 1 refused with its reason; Undo removes both rows.
  - DV-C2: start an emotion import of several large synthetic images, then press Back to close Studio before the store finishes -> no rows; the not-added toast with the count; relaunch, and the files are gone after the boot sweep.

## Locale keys

S3a (8 new, 1 reworded):
- `studioFormNameEmpty` "The name can't be empty"
- `studioDisplaySegPhoto(n)` "Portrait {n}"
- `studioDisplaySegScreen` "Screen"
- `studioDisplaySegAssets(n)` "Assets {n}"
- `studioScreenFilled` "Filled in this mode's default wording · your own wording is kept"
- `studioDefaultTag` "Default"
- `studioDefaultReset` "Reset to default"
- `studioScreenFillHidden` "The emotion instructions show once \"Inlay Screen\" is on" (names the existing `inlayViewScreen` label)
- Reworded `studioHistoryNone`: "History is kept for a character's forms, its assets and its chat note. Select one of them to see its history."
- Reused: `name`, `viewScreen`, `none`, `emotionImage`, `imageGeneration`, `emotionWarn`, `largePortrait`, `inlayViewScreen`, `imgGenPrompt`, `imgGenNegatives`, `imgGenInstructions`, `emotionInstructions`, `insertAssetPrompt`, `assetStyle`, `static`, `dynamic`, `hideChatIcon`.

S3b (14): `studioPortraitMain`, `studioPortraitAdd`, `studioPortraitAddNote`, `studioPortraitReplace`, `studioPortraitMakeMain`, `studioPortraitOthers` (alternates heading), `studioPortraitPromoted`, `studioPortraitRemoved`, `studioPngNote(n)`, `studioStepPortraitAdd`, `studioStepPortraitRemove`, `studioStepPortraitMain`, `studioPortraitFileGone` ("The photo's file is gone, so this step was dropped"; no name), `studioPortraitStoreFail`.

S3c (7):
- `studioPickResult(n, m)`, `studioPickBadType(ext)`, `studioStoreFail`, `studioRetry`, `studioDropRow`, `studioImporting`.
- `studioImportNotAdded(n)` "{n} files were not added because Studio closed", per the MC-4135 wording. Pluralisation and wording go to the translator for the 7 locales.
- Emotion Add reuses the `add` key used by `StudioAssetList` (`language.add`).
- Key order: S3b's portrait add, which posts `studioImportNotAdded(1)`, lands before S3c. The key is therefore added in S3b with its 7 locales, and S3c only reuses it.

## Risks and trade-offs

- R1 A whole-value `portraitSet` makes any outside edit of `image` or `ccAssets` (classic, another tab's reload) fail the step's precondition, and the undo is then refused rather than merged. Chosen for a small op set and an exact inverse; row-level ops would need a fourth asset array of object rows plus a scalar op.
- R2 The router change for `newGenData.*` changes how S3a-written reverts store merge texts, and older builds refuse those records (I2). Mitigated by A-T10 and the opus Gate 2.
- R3 The `name` path joins restore points and revert, so a restore can rename a character. Classic has no rename side effects (`CharConfigPanel.svelte:340` binds directly; sizing R5), so this is acceptable.
- R4 Hiding the emotion list in non-emotion modes also hides its finder and merge there (classic parity). The tree count still includes those images (`ownerModel.ts:376`).
- R5 S3b and S3c both need the S7-0 history-core slot, and S3a also does (MC-4130). The three run serially.
- R6 Files stored before a refused add or an ended visit stay orphaned until the next boot sweep (MC-4135, the same as classic).
- R7 Visit-bound imports: a second `openStudio` while Studio is open starts a new visit (`studioScreen.svelte.ts:171-187`), so an import running then is not added and reports the toast. Rare (a second "Open in Studio" during an import); the toast tells the user.
- R8 `StudioDisplaySegPhoto(n)` counts before S3b ships the tiles: S3a shows the count of data that is already present. Harmless.

## Finding dispositions

- F1 ADDRESSED: the portrait snapshot covers `{ image, alternates, pngExif }` through Working. Test B-T10 (d), mutant MB16.
- F2 ADDRESSED: C4, C-T8, C-T9, MC6..MC9, `studioImportNotAdded(n)` with 7 locales. Folder landing skipped on refusal or when the list is gone (`ImportLanding.alive`). Plus a source finding beyond the verdict: the service guard does not refuse after `closeStudio` with the selection unchanged, so the job checks the visit itself.
- F3 ADDRESSED: the `goneKind` marker plus `goneFileText` in all three sites. `StudioScreen.svelte` and `studioToasts.ts` are listed. B-T14, MB17.
- F4 ADDRESSED: relabelled. A-T11, A-T12 and C-T1 stay reproducers. B-T5 is stated as a reproducer only against the MB1/MB3 mutant base.
- F5 ADDRESSED: A-T6 asserts the exact op list with an already-equal key case. A-T7 checks no `data-default` on an unchanged key.
- F6 ADDRESSED: gates stated in scope, step 5 and A4. A-T5 table, MA10.
- F7 ADDRESSED: B-T5 uses a fresh service over the same store double.
- F8 ADDRESSED: plain copies (MB18), `portraitSet` in the order and folder trigger (I9), segment counts, the routing note, and the two extra test files.

No finding is rebutted.

## Premises

| premise | status |
|---|---|
| Studio has no real picker; `AssetPickerPort` is an interface only; `StudioDetail` passes no picker | REOPENED: `assetPresentation.ts:73-75`, `StudioAssetList.svelte:20-31, :178, :952-955, :1107`, `StudioDetail.svelte:269` |
| Classic portrait add/swap/remove mechanics | INHERITED FROM SIZING via r1 (r1 REOPENED `characters.ts:199-298`, `CharConfigPanel.svelte:462-547`) |
| `updateInlayScreen` reads three fields, writes all four keys, keeps author text | REOPENED: `inlayScreen.ts:74-113` |
| Classic 화면 gates: emotion list, instructions, inlay switch, imggen texts | REOPENED: `CharConfigPanel.svelte:580-672` |
| Classic inlay normalisation of `additionalAssets` exists only in the emotion branch | REOPENED: `CharConfigPanel.svelte:644-654` vs `:667-671` (MC-4134 drops it in both) |
| Revert net-zero drop compares a per-target JSON snapshot; chains skip net-zero targets | REOPENED: `historyModel.ts:1796-1840, :2047-2051, :2110-2127, :2251-2300` |
| Gone-file notice text sites | REOPENED: `studioToasts.ts:219-221`, `StudioHistoryPanel.svelte:188`, `StudioScreen.svelte:193`; `goneName` via `goneNameOf` `ownerHistory.svelte.ts:865-867`, notes `:1073-1101` |
| The write guard refuses `not-selected` by `selectedStudioCharacterId()` and `studioScreen.chaId` only | REOPENED: `studioSetters.ts:110-113` |
| `closeStudio` keeps `chaId` and `visitId`; a new open makes a new `visitId`; a selection move closes Studio | REOPENED: `studioScreen.svelte.ts:68-71, :107-111, :118-140, :155-160, :186-187, :198-201` |
| App-wide plain toast API | REOPENED: `toastHost.svelte.ts:52-58, :132-135, :1073-1075` |
| `orderAssetWrites` rank and the folder trigger condition | REOPENED: `assetSetters.ts:354-358`, `studioSetters.ts:560-566` |
| The list has an `unmounted` flag usable for `ImportLanding.alive` | REOPENED: `StudioAssetList.svelte:502-503` |
| U2: `historyModel.ts` has a per-path list that a new text path must join | INHERITED FROM r1 (REOPENED there; Gate 1 CONFIRMED) |
| U4: insert into an absent `additionalAssets` is refused | INHERITED FROM r1 (REOPENED there; Gate 1 CONFIRMED) |
| U5: MC-1185, MC-1200, MC-1206, MC-1215, MC-1700, MC-1701, MC-1827 wording | INHERITED FROM r1 (REOPENED there) |
| U1: labels re-derive after a name write | INHERITED FROM SIZING (INFERRED); settled by D-A1/A-T3 |
| U3: imports leave data URLs in `image`/`ccAssets` | INHERITED FROM SIZING (UNCERTAIN); made harmless, because retention and probing take stored-asset paths only (`historyModel.ts:880-882`) |
| The GC keep-set roots `image`, non-group `ccAssets[*].uri` and the retained pairs | INHERITED FROM r1 (REOPENED there; Gate 1 CONFIRMED) |
| The removal refusal and retained recompute run for any write that `touchesAssets`/`removesAssetRow` select | INHERITED FROM r1 (REOPENED there; Gate 1 CONFIRMED) |
| The history record keeps v2 for widenings that older builds refuse whole; an unknown op makes the record unreadable | INHERITED FROM r1 (REOPENED there; Gate 1 CONFIRMED) |
| New `studio-*` parts need no census edit | INHERITED FROM r1 (REOPENED there; Gate 1 CONFIRMED) |
| The reused locale keys exist | INHERITED FROM r1 (REOPENED there; Gate 1 CONFIRMED) |
| Card import writes `prebuiltAssetCommand: ''`, raw `newGenData` and an array `ccAssets` | INHERITED FROM r1 (`characterCards.ts:1818, :1827, :1829`); `ccAssets` array per Gate 1 F1 (`:1728-1733, :1823`) |
| No name side effects in classic; `hideChatIcon` sits in classic Advanced | INHERITED FROM SIZING (`CharConfigPanel.svelte:340, :1360`) |
| S7-0 branch content | NOT READ (no committed changes visible); anchors listed instead |

## Open items

None open.

Settled since r1 and built in:
- r1 OQ-1 (inlay switch and the asset list): MC-4134, option (a). The list is left as it is (S3a step 7, I10, A-T15, MA9).
- r1 OQ-2 (an import that outlives the Studio visit): MC-4135, option (a). The import finishes only within its visit; otherwise it shows the not-added toast (S3c, I11, C-T8, C-T9, MC6..MC9).

Notes for the Orchestrator (routing, not product):
- The brief assigned emotion-list gating to S3c; this plan moves it to S3a (reason under Requirements).
- S3a's reviewer is raised to opus-reviewer. Record this as a routing decision, not as an amendment of MC-4130.
- The portrait add applies the MC-4135 visit rule by analogy (S3b Mid-await guard). This is a designer choice for consistency, using the same toast key. If the Orchestrator reads MC-4135 as covering list imports only, the alternative is a silent landing after a close; that would be the only product edge to confirm.
- The S7-0 anchors must be re-read after #685 merges.

Artifacts: `C:\Users\yor42\AppData\Local\Temp\risu-b715\b61\c681\PLAN.md` (this file, revised in place as the brief directs; r1 is kept by the Orchestrator as `PLAN-r1.md`). No scratch files, no repository writes, no commands with side effects.
