# Studio preset list management (#710)

Status: **spec, revision 2** (2026-11-28). Ticket yor42/RisuTanium#710. Spec only (MC-3902): no application code. The build lands as staged PRs on #710 and only the last stage closes it. This file **extends** [PRESET_ADVANCED_SPEC.md](PRESET_ADVANCED_SPEC.md) (S4, #682): the `preset:<id>` owner, routing by id (4.1), the gone-preset rule (section 1, MC-3896) and the name path (4.7). It does not repeat them. Decisions: MC-4044 (this ticket), MC-4030 (Studio is feature complete against classic), MC-3896 (a preset deleted or replaced while its Studio form is open), MC-3890 (routing by id), MC-1758 (preset history is memory-only), MC-3894 (no save chip in the preset form). Open tickets this respects: **#148** (CHORE-574: preset undo, ten restore points per preset, 30-day Recently Deleted; "open, not planned yet") and **#150** (CHORE-576: preset edits save as you type; open, first needs a save-cost measurement). The maintainer's answers of 2026-11-28 are D5 to D9 in section 9; **MC ids for them are assigned by lane A** (this brief names no block).

Marked **(design default)** = chosen inside a decided intent, open to veto. Evidence is source-read on main `4af04dca0`; anchors are dated to that snapshot and re-read at Gate 1.

## 0. Scope

What classic's preset list offers (`Setting/botpreset.svelte`, opened as a modal from the chat settings), what the data layer already holds, and what comes to Studio:

| Capability | Classic today | In Studio |
|---|---|---|
| Switch the active preset | click a row (`changeToPreset(i)`, saves the current first) | yes, "Use in chats" |
| Create | `+`: clone of `prebuiltPresets.OAI2`, name "New Preset", fresh id, folder dropped | yes |
| Copy | per row: `copyPreset(i)` saves the current preset, clones the slot with a fresh id and **keeps the folder**, appends " Copy" to the name | yes |
| Delete | per row: refuses the only preset (`errors.onlyOneChat`), confirms `removeConfirm + name`, switches to preset 0, splices, reloads preset 0 | yes (D6, D9: classic's confirm and rules, with one deliberate difference, 4.4) |
| Import | `importPreset()`: file picker for `json`, `preset`, `risupreset`, `risup`; `.risup/.risupreset` single or bundle (a preview prompt), ST converters, NAI preset, trust rule (`trustImportedPreset`) | yes, the same function |
| Export | per row: `alertCardExport('preset')` then `downloadPreset(i,'risupreset')` or a Realm upload; select mode: `downloadPresetBundle(ids)` | file export and bundle export (D7); Realm upload and compare stay in classic |
| Rename | edit-mode text field on the row, no validation | yes, through the S4 name path |
| Reorder | drag and drop (`movePreset`, keeps `botPresetsId` pointing at the same preset) | yes: buttons and drag |
| Hotkey slot | **badge only** in the list (`slotBadgeFor`); assignment is in Settings, Hotkeys (`HotkeySettings.svelte`, `planSlotAssign`, swap confirm, undo) | badge and assign (D5, 4.6) |
| Folders | **no controls**: folders exist in data (`db.presetFolders`, `botPreset.folderId`); a bundle import creates them from names, `.rtb` carries them; the list shows no grouping | manage them (D8: create, rename, delete, move a preset in or out; grouped display, 4.5) |
| Compare two presets | `PromptDiffModal`, shown when `showPromptComparison` is on | stays in classic (D7); a classic link row |

Out of scope: preset undo, restore points and Recently Deleted (#148), save-as-you-type (#150), the preset save chip (#666), the preset form fields (S4, #706, #707), the toggle builder (#650), the Realm upload (D7), `.rtb` restore.

## 1. Today (source-read)

| Fact | Anchor (`src/`) |
|---|---|
| A preset is an entry of `db.botPresets`; the active one is `db.botPresetsId` (an **index**). Each entry carries fork meta `id` (uuid), `folderId`, `slot` (1 to 9). `assignPresetIds` runs at load: missing or shared ids are re-minted (shared: all re-minted, slot cleared, folder kept). `freshPresetMeta(p, {keepFolder})` gives a new id and drops the slot. | `ts/storage/presetMeta.ts` |
| Folders are one level: `createPresetFolder`, `renamePresetFolder`, `deletePresetFolder` (every member becomes folderless), `movePresetToFolder` exist and are used by the bundle import (`presetBundle.ts`) and `.rtb` restore, not by any list UI. `PresetFolder = {id, name}`; `db.presetFolders` is a top-level list. | `presetMeta.ts`; `database.svelte.ts` (`PresetFolder`); `drive/rtbSettingsRestore.ts` |
| Hotkey slots: `PRESET_SLOT_COUNT = 9`, one resolver (`presetIndexForSlot`: first valid holder), `planSlotAssign(presets, n, target)` computes the swap (the displaced holder gets the mover's old slot, further holders none), `applySlotPlan` writes it and refuses when a preset is gone, `slotUndoAction` is a toast Undo that re-reads and refuses when a later edit changed any affected slot. | `presetMeta.ts`; `setting/hotkeyPage.ts`; `Setting/Pages/HotkeySettings.svelte` |
| `changeToPreset(i, savecurrent)` saves the current working copy into its slot (`saveCurrentPreset`, rebuilding the slot from `db.*`), then `setPreset`. `copyPreset` and `downloadPreset` call `saveCurrentPreset` first; `importPreset` does not (it pushes new presets or hands off to the bundle import). | `ts/storage/database.svelte.ts` (about 2327-2475, 2477-2600, 2614-2960) |
| Single export strips meta (`withoutPresetMeta`) and share-unsafe values (`shareSafePreset`), then writes an encrypted RPack `.risupreset`/`.risup`. Bundle export (`downloadPresetBundle(ids)`) writes every selected preset share-stripped, with folders as names, at most `MAX_BUNDLE_PRESETS = 1000`, and shows the keys-left-out notice. | `database.svelte.ts` `downloadPreset`; `storage/presetBundle.ts`, `presetBundleFlow.ts` |
| Studio's tree lists the **active preset** under the Presets group and every other preset in a paged "other presets" subgroup; a preset owner is selected by **id** (`studioScreen.selectedPresetId`). When the pinned id has no holder or several (delete, import, restore), `StudioDetail` clears the selection with `studioRefusalPresetGone` (existing effect). | `lib/Studio/StudioTree.svelte` (about 155-190); `ts/studio/studioScreen.svelte.ts`; `lib/Studio/StudioDetail.svelte` (about 126-175) |
| The S4 name path `presetName` (slot only) is one history step of the preset's own session history and already allows an empty name. | S4 3.1, 4.7 |
| Classic's list is a windowed modal (`WindowedSegment`) over `DBState.db.botPresets`, rows keyed by position; drag data is the row index (`RISU_PRESET_DRAG_TYPE`). | `Setting/botpreset.svelte` |

## 2. Where it lives, and the data rules

- **A "Manage presets" sheet opened from the Presets group header of the Studio tree** (D9). It is a Studio sheet like `StudioRestoreSheet`: a dialog with Back closing it (`registerBackHandler`, as classic's modal does), one column on a phone. Like `StudioRestoreSheet` it has no `inert` and no focus trap; unlike it, it does **not** hold the toast stack back (the restore sheet does), so the slot-swap Undo toast is delivered while the sheet is open. Test L-c2 asserts that the toast host is not held; stacking order is a device row. It does **not** replace the tree, which keeps opening any preset for editing by id. The classic modal stays untouched and reachable.
- **By id, never by index.** Every action takes the preset's `id`, resolves it at the moment it runs (`botPresets.findIndex(p => p.id === id)`; exactly one holder, else the action refuses with `studioRefusalPresetGone`) and only then calls the index-based data-layer function. A list rendered from a stale snapshot, a reorder or an import between render and click cannot hit the wrong preset (the S4 routing rule, 4.1, applied to list actions). A preset without a usable id (cannot happen after load) is shown read-only.
- **Store-backed (DD-157).** The sheet holds only ids and UI state (collapsed folders, selection, open row menu); the rows are derived from `DBState.db.botPresets` and `db.presetFolders` on every render.
- **List operations are not steps of any preset's session history.** They change the list or list-level metadata (`botPresets` order and membership, `presetFolders`, `folderId`, `slot`), not a preset's settings; the preset's history (MC-1758) is memory-only and per preset and cannot hold "this preset was created". Reversal is provided only where the product already has it: the **toast Undo** of the Hotkeys page for slots (`slotUndoAction`, reused unchanged), the same toast shape for folder move and reorder (design default: memory-only, refuses when a later edit changed what it wrote, as `slotUndoAction` does), and **no undo for create, copy, import, delete** (delete waits for #148's Recently Deleted; a created or copied preset is deletable). Rename is the S4 name step (undoable in the preset's session history).
- **Saving.** No Studio-side mark. `botPresets` mutations are covered by the preset deep-snapshot effect and `presetFolders` by the generic top-level loop (S4 6.6). Because several operations first call `saveCurrentPreset()` (copy, export, change) the sheet never keeps a draft of a preset's fields, so a save never races a Studio edit (S4 1).
- **Compatibility** (MC-175, MC-223, MC-774, MC-350). No new `botPreset` or `Database` key, no migration, nothing new in `.bin`/`.rtb`. Every operation calls the existing data-layer function or its extracted pure body (below), so ids, folders, slots and export bytes are exactly those classic produces. Export and import go through `downloadPreset`, `downloadPresetBundle` and `importPreset` unchanged; no network request is added.

## 3. Sheet layout

Top to bottom:

1. **Header**: title (`presets`), close.
2. **Actions**: New preset, Import, Select to export (bundle select mode, as classic's), New folder.
3. **List**, grouped: one section per folder in `presetFolders` order, then the unfoldered presets (D8). A folder header shows its name, count and collapse (per device, DD-099 storage), and a menu (Rename, Delete). A preset belonging to an id that names no folder reads as unfoldered (`presetFolderOf`). Within a section the order is the order in `botPresets` (the one global order is kept; a folder is a filter of it, so reorder never changes membership).
4. **Row**: icon (24 px, `image`) or placeholder, name (the id when empty, as `presetNameOf`), badges: active ("In chats"), hotkey slot number (`slotBadgeFor`, only when the resolver lands on this preset), select checkbox in select mode; a primary tap area that opens the preset in Studio (selects `preset:<id>` in the tree and closes the sheet) and a **row menu button** (≥ 44 px).
5. **Row menu**: Use in chats, Copy, Rename, Export, Move to folder (a folder list plus "No folder"), Hotkey slot, Move up, Move down, Delete.
6. **Footer** line: the classic link row "Compare presets and upload to Realm are in the classic editor" with the classic button (`studioOpenClassic`-style, D7), and the `quickPreset` hint text classic shows.

Phone layout: one column, rows as cards, menu as a bottom sheet, targets ≥ 44 px, drag not required (buttons give every capability).

## 4. Behaviour

### 4.1 New

`prebuiltPresets.OAI2` structured clone, name `New Preset` (classic's English literal, replaced here by the key `studioPresetNewName`; design default, a new preset has a translated name), `freshPresetMeta(..., { keepFolder: false })`, pushed to the end (inside the section the user was in when a folder section's own New is used: sets `folderId` after creation, design default). Does not change the active preset. Shows the new row selected with a "New" highlight; opening it in Studio is one tap.

### 4.2 Copy

`copyPreset` semantics: `saveCurrentPreset()`, structured clone of the source slot by id, `freshPresetMeta(..., { keepFolder: true })`, name + " Copy" (the classic suffix as the key `studioPresetCopySuffix`), appended. The copy of the **active** preset copies the just-saved slot (classic's order). The copy never takes the original's slot or id.

### 4.3 Import

The Import button calls `importPreset()` unchanged (the file type picker, the bundle preview and its folder-name handling, the ST converters, the NAI branch and the trust rule). Errors it throws surface as classic's alerts. A bundle import that creates folders shows them in the sheet at once (store-backed). A single import cancelled writes nothing. Studio adds no format and no preview of its own.

### 4.4 Delete (D6, D9)

- Refused for the only preset with `errors.onlyOneChat`.
- Confirm text `removeConfirm + name` (classic's), via `alertConfirm`.
- **Deleting the active preset** is classic's sequence, run by a Studio caller: `changeToPreset(0)` (which saves the current preset), splice the entry, `changeToPreset(0, false)` (the same two calls classic makes; the final reload sets the pointer to 0 whatever the deleted index was). **Deleting a preset that is not active** does **not** switch the active preset (the one deliberate difference from classic, which switches to preset 0 on any delete; maintainer answer D9). Only the splice and pointer step is extracted: a pure `removePresetKeepingActive(db, id)` removes the entry and shifts `botPresetsId` when the removed entry lies before the active one, used by Studio's non-active case. Classic's delete sequence is **not** extracted and not changed. The id is resolved and the "only preset" refusal re-checked **after** the confirm's `await` (the list may have changed while it was open); a missing id refuses as gone; `removePresetKeepingActive` leaves a `botPresetsId` of -1 or out of range alone and treats "is the deleted preset active" as false then (L-F1, tests L-a2b, M-a1b).
- **A Studio form open on the deleted preset** (MC-3896): the existing effect clears the selection with `studioRefusalPresetGone`; typing since the last write is dropped; nothing changes in another preset. Its history entry is discarded with the owner (memory-only). Pending slot or move Undo toasts for it refuse (the preset is gone).
- No undo (D6: classic's rules; #148 will add Recently Deleted). #148's restore with the old id must make a selection cleared as gone valid again (S4 1); this spec does not block it: ids are stable keys and the sheet re-reads.

### 4.5 Folders (D8)

- **New folder** (`createPresetFolder(db, name)`), **Rename** (`renamePresetFolder`), **Delete** (`deletePresetFolder`: members become folderless; a confirm that names the count of presets that will become unfoldered, a presets-never-deleted line), **Move a preset** (`movePresetToFolder(db, index, folderId|undefined)`, index resolved from the id at the moment).
- Folder names: any text including empty is stored as typed? **Design default:** trimmed, empty refused ("name required"), length cap `MAX_BUNDLE_FOLDER_NAME` (200 UTF-16 units, the cap bundle import already applies), duplicates allowed (ids identify folders).
- One level only (no nesting), as the data layer.
- Folder order is `presetFolders` order; Move up/down on a folder header (design default; no drag).
- **Export keeps working with folders:** a bundle carries folder names (existing behaviour); a single export has no folder (`withoutPresetMeta`).
- `.bin` interplay: upstream knows none of `id`, `folderId`, `slot`, `presetFolders`; they travel untranslated (fork meta, as `presetMeta.ts` states), so nothing changes in the leave-out summary.

### 4.6 Hotkey slots (D5)

- The row shows the badge only when the Ctrl+n resolver lands on this preset (`slotBadgeFor`).
- Menu "Hotkey slot" opens nine choices plus "None". Choosing a slot another preset holds shows the **same swap confirm** as the Hotkeys page (the displaced preset gets this preset's old slot, `planSlotAssign`); confirm commits with `applySlotPlan` and shows the toast with `slotUndoAction` (reused unchanged); cancel writes nothing. "None" runs `planSlotAssign(presets, n, null)` for the shown slot, which clears **every** holder of that slot including hidden duplicates the badge does not show; a duplicate holder that is not the resolver's holder has no menu path of its own (known limitation, as on the Hotkeys page).
- The same plan functions and texts as the Hotkeys page (`settingsShellHkSlotSet`, the swap-confirm texts `settingsShellHkConflict(name)`, `settingsShellHkSwapOutcome`, `settingsShellHkSwap`, `settingsShellHkSwapped` (the wording direction is preset-centric here, action-centric on the Hotkeys page; Gate 1 pins which name goes where) and the Hotkeys page's undo texts `settingsShellHkUndone`, `settingsShellHkUndoRefused`, `settingsShellHkUndoFailed`; their "Shortcut change undone" wording is accepted for a slot change), so the two surfaces cannot drift; the Hotkeys page itself is unchanged.
- A slot write is a mutation of `db.botPresets` (covered by the existing hook).

### 4.7 Use in chats

`changeToPreset(index)` (saves the current first, as classic), by id. The active badge moves; the sheet stays open (classic closes its modal; Studio keeps the sheet, design default, because the goal is to manage). Refused when the preset is gone.

### 4.8 Rename

A text field in the row menu (or inline edit on a phone sheet) writes `slot.name` through the S4 `presetName` path: composition gate, empty allowed (MC-4037), one coalesced history step of that preset's session history, banner `studioBannerPresetSession` not shown here (the sheet is not the form). A rename of the active preset writes the slot (slot-only field), so `saveCurrentPreset` carries it.

### 4.9 Export

- **Per preset:** `downloadPreset(index, 'risupreset')` directly (D7). Classic's `alertCardExport('preset')` dialog (file or Realm) is not shown: the Realm choice is not offered. The data written is the same bytes classic's file choice writes (share-stripped, without meta). The leave-out notice classic's flow shows is unchanged.
- **Select to export:** select mode with checkboxes, "All", a count, Cancel; `downloadPresetBundle(ids)` (more than `MAX_BUNDLE_PRESETS` refused with `errors.presetBundleTooMany`; `exporting` guards a double tap, as classic). Selection holds ids, so a reorder or removal during selection does not shift it.
- The sheet never exports a preset's `proxyKey`/keys: `shareSafePreset` is the existing strip (MC-3074/3076 behaviour for unreadable keys stays as that flow defines).

### 4.10 Reorder

Move up/down in the row menu and drag by a handle (pointer devices; design default). Both call one extracted pure `movePresetById(db, id, toIndex)` (the body of classic's `movePreset`, `toIndex` an insertion position before removal with the forward adjustment of -1, which keeps `botPresetsId` on the same preset); classic calls it too (class CG). A reorder is a mutation of `botPresets` order, covered by the existing hook; the toast Undo restores the previous order (and `botPresetsId` by id) only while the order is unchanged since. With folders, moving up or down moves within the global order past the neighbouring row **of the same section** (design default: the neighbour in the same folder; `toIndex` is the global index of that neighbour for up, and one past it for down; rows of other sections between them shift by one and keep their order among themselves, so the moved row's order relative to them changes, which is the intent).

### 4.11 Concurrency and interplay

- **#150 (save as you type).** If the active preset's slot is saved on each edit, list actions that call `saveCurrentPreset()` first stay correct and idempotent. Nothing in this spec stores the slot elsewhere.
- **#148 (restore points, Recently Deleted).** A deleted slot would be kept elsewhere; delete here removes from `botPresets` exactly as classic does, so #148 hooks the same function. Studio adds no second store of deleted presets.
- **A classic modal open at the same time** edits the same list; both read it fresh on each action, so there is no cached list to go stale (the by-id rule).
- **Active preset replaced by import or `.rtb` restore** while the sheet is open: the next render reads the new list; actions on ids that no longer exist refuse as gone.

## 5. Engine changes

- New pure module `ts/storage/presetListOps.ts` holding `newPresetFromTemplate`, a `newPresetFromTemplate` helper that takes `db`; copy calls `copyPreset(resolvedIndex)` unchanged and only renames the suffix with `studioPresetCopySuffix` (no `DBState` import, so it loads in harnesses that replace `database.svelte`, as `presetMeta.ts` states), `removePresetKeepingActive(db, id)` and `movePresetById(db, id, toIndex)`. Classic's `botpreset.svelte` calls the extracted `movePreset` body and keeps its own delete sequence untouched (4.4); the move is CG-pinned.
- New components: `StudioPresetListSheet.svelte` (sheet), `StudioPresetRow.svelte`, `StudioPresetFolderHeader.svelte`, `StudioPresetSlotChooser.svelte` (the swap confirm reuses `planSlotAssign`/`slotUndoAction`); the Presets group header in `StudioTree.svelte` gains the opening button.
- **No registry change, no history value kind, no new `SetPath`**: the sheet writes the list directly through the data-layer functions (as the Hotkeys page does) and only rename goes through the S4 service. (This is the reason the stage Gate 2 is not an opus review of the history contract.)
- `studioScreen` gains `presetSheetOpen` (UI-only). Selecting a row calls the existing select-by-id.
- Dirty tracking dependencies unchanged; stage tests prove a folder rename and a slot swap mark the save with the real `dbChangeEffects` hook.

## 6. Changed critical contracts, failure scenarios

Contracts touched: the persisted `botPresets` list (membership, order, ids, folder ids, slots) and `presetFolders`, the active-index invariant `botPresetsId`, and the export bytes (unchanged). **Gate 1 plan review (Tier 2) and, because delete/move/switch re-index a persisted list and an active pointer, an opus-reviewer at Gate 2 of stage a** (the extraction of delete and move bodies and the active-index invariant); later stages go to a native Sonnet adversarial reviewer.

| # | Failure scenario | Guard |
|---|---|---|
| L-F1 | An action hits the wrong preset because the list changed between render and click (index-based call). | by-id resolution at the moment, exactly one holder; test L-a2 |
| L-F2 | Deleting or moving a preset leaves `botPresetsId` pointing at a different preset: the chats silently change preset. | `removePresetKeepingActive`/`movePresetById` keep the pointer; move CG against classic; tests L-a3, L-a4 |
| L-F3 | Deleting the active preset leaves the working copy of the deleted one in `db.*` and the next save writes it into another slot. | classic's save, switch, remove, reload sequence reused; test L-a3 |
| L-F4 | Delete of a non-active preset switches the active preset (classic side effect) against the answer D9. | the non-active path never calls `changeToPreset`; test L-a5 |
| L-F5 | A Studio form open on a deleted preset keeps writing, or its pending typing lands on another preset. | MC-3896 effect; test L-a6 |
| L-F6 | A slot swap leaves two presets on one slot, or the toast Undo overwrites a later edit. | reuse `planSlotAssign`/`slotUndoAction` unchanged; test L-c2 |
| L-F7 | Folder delete deletes presets, or a folder id left on a preset names no folder and hides it. | `deletePresetFolder` clears `folderId`; `presetFolderOf` reads a dangling id as unfoldered; tests L-b3, L-b4 |
| L-F8 | Import over the same ids or a bundle changes the list while a selection or a pending toast refers to it. | ids, store-backed rows, refusal as gone; test L-a7 |
| L-F9 | Copy of the active preset copies a stale slot (not saved), losing the latest edits. | `saveCurrentPreset()` first; test L-a8 |
| L-F10 | Export includes meta or keys, or Realm upload is triggered by accident. | direct `downloadPreset(..., 'risupreset')`; export bytes equal classic's; test L-d1 |
| L-F11 | A bundle selection holds indices and shifts after a reorder. | ids; test L-d2 |

## 7. Stages and required tests

Each stage is one PR on #710, its own Gate 1 (Tier 2) and Gate 2; only stage d says `Closes #710`. Each adds its `en.ts` keys in all 8 locales and passes `localeParity` in the same PR (MC-058). Fixtures are built as the product builds presets (MC-329): slots by `presetFromWorkingSettings`/`savedPresetFor`, ids by `assignPresetIds`, the real `changeToPreset`, `saveCurrentPreset`, `dbChangeEffects`, `importPreset` with synthetic bytes; component tests in jsdom with a `$state` `DBState`. Classes RR/CG/DX as S4; all RR are DESIGNED, NOT DEMONSTRATED until the build shows the pre-fix failure.

**Stage a: the sheet, list, new, copy, delete, use in chats, rename, open in Studio, extracted pure ops.** Gate 2: **opus-reviewer** (persisted list, active-index invariant).

- L-a1 (CG) classic's move behaves as before after `movePresetById` is extracted: same list and `botPresetsId` for a fixture set (move across the active index, to the ends); `removePresetKeepingActive` has pure tests for delete before, at and after the active index (L-a4); L-a3 covers the active-delete sequence with the active preset at index 0, in the middle and at the end, and a CG test that Studio's sequence and classic's end in the same state.
- L-a2 stale render: reorder the list after the sheet rendered, then act on a row: the preset with that id is affected, not the one now at that index; an id with no holder refuses (RR vs an index-based build).
- L-a3 delete of the active preset: confirm, switch to the first remaining preset, working copy equals that preset, deleted slot absent, no stale `db.*` saved into another slot.
- L-a4 delete of a preset before the active one keeps `botPresetsId` on the same preset.
- L-a5 delete of a non-active preset keeps the active preset (RR vs a build that runs classic's sequence for a non-active delete: the active preset must not change); the only preset is refused.
- L-a6 delete while the Studio form of that preset is open: selection cleared with the gone text, nothing written elsewhere (the test mounts `StudioDetail` with an open form and unflushed typing, for the deleted preset and for a different preset whose list index shifts; a store-level test is not accepted since the S4 clearing is a `$effect`).
- L-a2b the confirm is open, the list is reordered or an import adds presets or the target is removed, the user confirms: the preset with that id is deleted, or the action refuses as gone; the "only preset" refusal is re-checked after the confirm (M-a1b resolves before the confirm). 
- L-a2c a dirty-hook test marks the save for new, copy, delete, reorder and import with the real `dbChangeEffects` hook.
- L-a7 import while a row menu is open: the menu's id is gone, the action refuses; others unchanged.
- L-a8 copy of the active preset carries the latest unsaved working values, keeps the folder, gets a new id and no slot, name suffixed.
- L-a9 new preset: fresh id, no folder, no slot, appended, active unchanged.
- L-a10 rename routes through `presetName` (active: slot; inactive: slot), one step, undoable in the preset's history; empty allowed.
- L-a11 use in chats saves the current then switches; the badge moves; the sheet stays open.
- Mutants (scratch only): M-a1 delete uses the index captured at render (L-a2); M-a2 `removePresetKeepingActive` forgets the pointer shift (L-a4); M-a3 delete always switches (L-a5); M-a4 copy skips `saveCurrentPreset` (L-a8); M-a5 new preset keeps the template's folder (L-a9); M-a1b delete resolves the id before the confirm (L-a2b).

**Stage b: folders (D8).** Gate 2: native Sonnet adversarial reviewer.

- L-b1 create/rename a folder: stored in `presetFolders`, trimmed, empty refused, 200-unit cap; L-b2 move a preset in and out: `folderId` set or deleted on the right preset by id; L-b3 delete a folder: members become folderless, no preset removed, confirm names the count; L-b4 a preset with a dangling `folderId` shows as unfoldered and can be moved; L-b5 grouped display order (folder order, then unfoldered), collapse state per device and restored; L-b6 folder rename and move mark the save with the real hook; L-b7 a bundle import's folders appear at once. Mutants: M-b1 delete removes the members; M-b2 move writes the folder id to the preset at the rendered index.

**Stage c: hotkey slots and reorder.** Gate 2: native Sonnet adversarial reviewer.

- L-c1 the badge appears only on the resolver's holder; L-c2 assigning a slot held by another preset shows the swap confirm; confirm swaps exactly as the Hotkeys page plan does; cancel writes nothing; the Undo toast restores and refuses when a later edit changed any affected slot (CG for the reused functions), and the toast host is not held while the sheet is open; a dirty-hook test marks a slot swap; L-c3 clearing a slot; L-c4 move up/down and drag give the same list, `botPresetsId` follows, within a folder section the neighbour is the same section's, on an interleaved fixture A(f1), X, B(f1) where moving B up passes A; L-c6 the Undo of a reorder and of a folder move restores the order and `botPresetsId` by id only while unchanged since, and refuses otherwise; L-c5 the Hotkeys page is unchanged (CG). Mutants: M-c1 the swap gives the displaced preset no slot; M-c2 a move crosses a folder boundary.

**Stage d: export, import, closing the ticket.** Gate 2: native Sonnet adversarial reviewer (bytes equal classic's; no new contract).

- L-d1 per-preset export bytes equal `downloadPreset(i,'risupreset')` through classic's file choice (same payload for a fixture, `downloadFile` mocked); no Realm path is reachable; L-d2 bundle selection by id survives a reorder; counts and `MAX_BUNDLE_PRESETS` refusal; L-d3 import: a single file, a bundle with folders, an ST file and a cancelled picker go through `importPreset` unchanged (CG); L-d4 the classic link row is present and compare/Realm are absent from the sheet. Mutants: M-d1 export dialog shown; M-d2 selection by index.

## 8. Copy (new `en.ts` keys; all 8 locales in the stage that adds them)

Reused keys (bare words such as `copy`, `remove`, `export`, `import`, `name`, `add`, `cancel` name the top-level `language.*` key the classic preset page uses; Gate 1 pins each namespace against `en.ts`): `presets`, `copy`, `remove`, `removeConfirm`, `errors.onlyOneChat`, `export`, `import`, `name`, `unnamedPreset`, `add`, `cancel`, `presetBundleSelect`, `presetBundleExport`, `presetBundleAll`, `quickPreset`, `studioOpenClassic`, `studioRefusalPresetGone`, `settingsShellHkPresetSlot`, `settingsShellHkSlotNone`, `settingsShellHkSlotSet`, `settingsShellHkUndone`, `settingsShellHkUndoRefused`, `settingsShellHkUndoFailed`, `othersUi.editMode`, `chatShellMoveUp`, `chatShellMoveDown`. New keys: `studioPresetListManage` (Manage presets), `studioPresetListActive` (In chats), `studioPresetUse` (Use in chats), `studioPresetNewName`, `studioPresetCopySuffix`, `studioPresetFolderNew`, `studioPresetFolderRename`, `studioPresetFolderDelete`, `studioPresetFolderDeleteConfirm` ({count} presets become unfoldered; no preset is deleted), `studioPresetFolderName`, `studioPresetFolderRequired`, `studioPresetMoveToFolder`, `studioPresetNoFolder`, `studioPresetSlotMenu`, `studioPresetClassicOnly` (Compare presets and Realm upload are in the classic editor.). Korean comes from the translator (MC-058).

## 9. Decisions this spec applies

- **Inherited:** MC-4044 (the ticket), MC-4030, MC-3896, MC-3890, MC-1758, MC-3894, MC-3902, MC-175/223/774/350 (compatibility), DD-157.
- **2026-11-28 answers (ids from lane A):** **D5** hotkey slots: badge and assignment in the Studio list (swap confirm, same plan as Hotkeys). **D6** delete: classic's confirm, last-preset refusal and gone handling; undo waits for #148. **D7** export: file and bundle export in Studio; Realm upload and compare stay in classic. **D8** folders: manage them (create, rename, delete, move; grouped display). **D9** (a) delete of a non-active preset keeps the active preset (a deliberate difference from classic); (b) list management lives in a "Manage presets" sheet from the Presets group header.

## 10. Open questions (maintainer)

None at revision 2. Design defaults open to veto: folder name rules (4.5), folder order buttons (4.5), the sheet staying open after "Use in chats" (4.7), toast Undo for folder move and reorder (2), per-section neighbour for move up/down (4.10), "New" inside a folder section assigns the folder (4.1).

## 11. Premises

| Premise | Status |
|---|---|
| Classic's list has no folder controls; slot assignment is only in Hotkeys; the list shows the slot badge | REOPENED (`botpreset.svelte`, `HotkeySettings.svelte`, grep of `presetFolders`/`movePresetToFolder` users, non-test `src`) |
| Classic delete switches to preset 0 for any deleted preset | REOPENED (`botpreset.svelte`) |
| `copyPreset` keeps the folder, drops slot and id | REOPENED (`database.svelte.ts`, `presetMeta.ts`) |
| `importPreset` and `downloadPreset*` can be called from Studio unchanged | NOT YET VERIFIED for UI side effects (alerts, file pickers in a Studio context): Gate 1 traces `alert.ts` host use |
| The Presets group header can host a button without changing tree keyboard navigation | NOT YET VERIFIED: Gate 1 reads `StudioTree.svelte` row model and its keyboard tests |
| #148 and #150 are open and unplanned; no stored preset history exists to conflict with | REOPENED (issue bodies, 2026-11-28) |
