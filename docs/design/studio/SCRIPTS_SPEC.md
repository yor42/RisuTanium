# Studio scripts kind: triggers, Lua, character 배경 HTML (spec)

Repository path: `docs/design/studio/SCRIPTS_SPEC.md` (worktree `708-scripts-spec-802cc8`). The designer role cannot write to the repository, so it keeps the source of each draft in scratch, and the session copies it into the worktree.

Status: **draft 6, spec only** (2026-11-24). **Gate 1 passed after round 5** (`[EDITORIAL]`; the editorial fixes R5-E1 to R5-E4 are applied).
- Revised after Gate 1 rounds 1 to 4, each `[REJECT]`: F1 to F10; N1 to N5 and E1 to E7; R3-1 to R3-4 and R3-E1 to R3-E6; R4-1, R4-2 and R4-E1 to R4-E5. After the third rejection the senior-advisor reviewed the mechanism (dispatch 708-adv1). Drafts 5 and 6 follow its direction, and round 4 accepted the mechanism. Section 16 answers every finding of every round, and of lane A's PR check, and lists the earlier failure scenarios with the invariant that now decides each.
- Ticket yor42/RisuTanium#708 (MC-3983). Spec first (MC-3902): no build starts before this file merges.
- Written against `origin/main` 2099bea7a. `origin/main` has since moved (1002ead68 at round 2); the build rebases and rechecks the §0 anchors it relies on.
- Builds on:
  - [S7_LORE_SPEC.md](S7_LORE_SPEC.md) revision 6: the shared object-list seam, §4 to §4.6;
  - [S6_REGEX_SPEC.md](S6_REGEX_SPEC.md) draft 6: the sibling list kind, §5;
  - [MODULE_ADVANCED_SPEC.md](MODULE_ADVANCED_SPEC.md) revision 4 (S5): the `lowLevelAccess` flag, the 배경 HTML form and foreign values, §1.3 and §10.

**Maintainer answers (2026-11-24; `Agents/mc/708.md`; section 12):**

| Q | Answer | MC |
|---|---|---|
| Q1 | **B**: native Studio V2 and V1 editors for all 101 V2 effect types; no hosted classic component; no classic link left on these kinds | MC-4110 |
| Q2 | **B**: an import asks while Low Level Access is on | MC-4111 |
| Q3 | **A**: replays of trigger content do not ask | MC-4112 |
| Q4 | **A**: CharacterJS is editable | MC-4113 |
| Q5 | **B+A**: a mode switch's whole-list item restores as an inverse replace; any other cross-mode item is refused | MC-4114 |

No product question is open.

**The mechanism, reconsidered at the second rejection and directed by the senior-advisor after the third (AGENTS.md).** The list's mode lives in row 0, while the seam rebuilds every deleted item from its tagged ops. Drafts 3 and 4 inferred a row item's mode from its row content and added one rule per finding, so each round found another route or row shape the rules did not cover.

Drafts 5 and 6 keep MC-4114 and the representation round 3 accepted (the mode switch as one step of tagged removes plus template inserts; the whole restore as an inverse replace). It replaces the per-case rules with three things:
- **one required op key, the span** (4.3). Every tagged trigger op records whether its run is the whole list (`list`) or rows deleted from a list in mode `v1` or `v2`. Restore acceptance compares the recorded span with the live list's mode, and row content is never read for acceptance;
- **four invariants, T1 to T4, and a closure table over every route** (4.3), as S7 §4.0 does for its own seam;
- **two display predicates that mirror the engine** (3.4). Every "runs" marker and note is derived from them.

The simpler alternatives each contradict MC-4114, so they were not taken:
- refusing every cross-mode restore is option A;
- making a switch undoable but not restorable drops the "always recoverable" consequence.

If a later Gate 1 round rejects the inverse replace or whole items again, the next step is a maintainer question on Q5 option A (section 15), not a sixth draft.

Decisions used: MC-058, MC-175, MC-223, MC-329, MC-350, MC-777, MC-1639, MC-1827, MC-3638, MC-3896, MC-3900, MC-3902, MC-3980, MC-3983, MC-3984, MC-3985, MC-4030, MC-4043, MC-4050, MC-4051, MC-4080, MC-4081, MC-4110 to MC-4114, DD-100.

A choice marked **(design default)** in section 13 was made here, inside intent the maintainer has already decided. Gate 1 can veto it without asking the maintainer.

**S7-0 dependency.**
- The trigger list joins S7's object-list seam: the `obj*` ops, `planObjStep`, and the per-list tables in `history/objectLists.ts`.
- S7-0 is being built in another session (`claude/685-s7-0-5d3d39`). On 2026-11-24 no seam file existed on that branch or on `origin/main` (Gate 1 rounds 1 and 2).
- This spec is therefore written against the S7 r6 **text**, not code. Section 4.6 lists the seam facts it needs (N1 to N11) and what happens if the merged S7-0 differs. In-progress S7-0 files are not cited as evidence.

## 0. Today (source read in this worktree, 2026-11-24)

| Fact | Anchor (`src/`) |
|---|---|
| A trigger is `{comment, type, conditions, effect, lowLevelAccess?}`. `type` is one of `start`, `manual`, `output`, `input`, `display`, `request`. | `ts/process/triggers.ts:26-32` |
| V1 has four condition types (`value`, `exists`, `var`, `chatindex`) in three shapes. V1 effects are a union of 15 shapes plus `triggercode`/`triggerlua`. V2 effects are a union of 101 declared `triggerV2*` types: a raw count of `^export (type\|interface) triggerV2\w+` in `triggers.ts`, COMPLETE for that regex. Gate 1 confirmed that the union matches the declarations. | `triggers.ts:34-80`; `TriggerV1Data.svelte:126-129, 317-331` |
| The V2 picker groups 98 types in 12 categories: Special 7, Control 12, Chat 10, Low Level 4, Alert 3, Lorebook V2 8, String 10, Data 8, Array 13, Dictionary 9, Others 7, Deprecated 7. The other 3 of the 101 are the structural `v2Header`, `v2Else` and `v2EndIndent`. Deprecated shows only while the app-wide `showDeprecatedTriggerV2` is on, and that setting's only toggle sits inside the V2 picker. | `lib/SideBars/Scripts/TriggerV2List.svelte:25-148, 459-477, 2898-2925` |
| **Defaults and forms.** Classic builds each new V2 effect from `makeDefaultEditType`: 99 `case 'v2…'` labels (the 98 pickable types plus `v2Else`), every default at `indent: 0`. It edits an effect in a per-type form (lines 2944-3971). 91 types have a form. Six types have no fields and show `noConfig`: `v2Loop`, `v2BreakLoop`, `v2StopTrigger`, `v2SendAIprompt`, `v2UpdateGUI`, `v2StopPromptSending`. `v2GetLorebookCount` has a default key, `outputVar`, but no form (Gate 1, executed key comparison). | `TriggerV2List.svelte:584-1528, 814-819, 2944-3971` |
| **Saving a new effect.** With no effect selected, Save **appends** the default (indent 0). With an effect selected (the picker opened from that row), it **inserts before** that effect at the **target's** indent. A new `v2If`, `v2IfAdvanced`, `v2Loop`, `v2LoopNTimes` or `v2Else` also gets its closing `v2EndIndent` (indent + 1; `endOfLoop` on the append path only), and with `addElse` a `v2Else` and a second `v2EndIndent`. The append and insert paths write different key sets for those rows. | `TriggerV2List.svelte:3976-4021` |
| **Editing an effect.** The context menu points the edit form at the **live** effect object (`editTrigger = effect`), so classic edits in place and Back does not undo. Save writes the form's object back and, for an If, adds or removes the Else pair. Edit is offered for every effect except `v2EndIndent`, whatever `checkSupported` says. | `TriggerV2List.svelte:2183-2188, 2303-2337, 4022-4079` |
| **Other effect rules.** Deleting a block opener **unwraps** the block (its `v2EndIndent` and any following `v2Else` pair go, the children are dedented). Copying an opener copies its whole block; copying `v2Else` does nothing. Paste inserts **before** the selected effect (or at the end), at the indent from `getInsertIndent`, rebasing a whole block. `getInsertIndent` is used only by paste and move. Drag uses `moveEffect`, guarded by `canMoveEffect` over `getBlockRange`. Alt+↑/↓ only swaps two same-indent neighbours when neither is a block opener or `v2EndIndent`. | `TriggerV2List.svelte:1530-1667, 1831-2000, 2065-2109` |
| **Effect menu.** Edit, Copy and Remove show for every effect except `v2EndIndent`. Paste shows for every row, `v2EndIndent` included. A double click on any row, `v2EndIndent` included, opens the picker to insert before it; that is how classic puts a first child into an empty block. | `TriggerV2List.svelte:2303-2362, 2745-2760, 2898-2910` |
| **V2 event list.** Row 0 is the hidden `v2Header` carrier, never moved or deleted. Add event appends `{comment: '', type: 'manual', conditions: [], effect: []}`. Delete (one or several selected) refuses when it would leave no event, and asks nothing. Events can be moved and dragged. Paste inserts **before** the selected event, from a `safeStructuredClone` clipboard. Keyboard on events: arrows, Alt+↑/↓ swap, Ctrl+C, Ctrl+V; **the Delete key is deliberately not bound for events** ("misclicks can cause huge data loss"). On effects, Delete deletes. Export writes `value.slice(1)` as JSON. Import appends a JSON array verbatim after a key check, so a file can bring in any effect type. A rename rewrites every `v2RunTrigger` target that named the old name. "Trigger On" picks one of the six types. | `TriggerV2List.svelte:505-542, 1669-1724, 2119-2160, 2552-2629` |
| `checkSupported`: on a `display` or `request` trigger, only allow-listed effects; never a "Special" effect elsewhere; "Low Level" effects only while the owner flag is truthy. Classic applies it to the picker and to the summary text; it never blocks editing. For a type it does not know, `formatEffectDisplay` shows the raw type text. | `ts/triggerEffectDisplay.ts:21-40, 86`; `TriggerV2List.svelte:575-583` |
| **One engine switch runs every effect kind.** `switch(effect.type)` holds the V1 cases, `case 'triggerlua'` (`runScripted` with the trigger's `lowLevelAccess`), and the V2 cases, so a V1 shape, a V2 type or a `triggerlua` effect runs wherever it sits in a list. The switch has no `default` branch (Grep `^\s*default\s*:` in `triggers.ts`: 0 matches), and it has no case for `triggercode` (Grep `triggercode` under `src/ts`, case-sensitive, `*.test.ts` excluded: 6 matches, COMPLETE, no executor: `triggers.ts` 2, `scriptMode.ts` 2, `itemText.ts` 1, `referenceTargets.ts` 1; Gate 1 R5-E3). Those, and any type outside the switch, run nothing. A row whose first effect is `triggerlua` or `triggercode` skips both the manual-name filter and the Trigger On filter, so it is considered on every run, and its other effects then run through the same switch. | `triggers.ts:1372-1385, 1498, 1730-1760` |
| **The engine's type sets already exist in Studio.** `KNOWN_V2_TYPES` lists the V2 types, typed as `triggerEffectV2['type'][]`: 101 entries, COUNTED. `V1_EFFECT_TYPES` lists the 15 V1 effect types. Both are module-private today. | `ts/studio/assets/referenceTargets.ts:92-117` |
| Classic shows each effect through `formatEffectDisplay`: an HTML string placed with `{@html}`, after every card-controlled value is escaped and `indent` is coerced to a number. `formatEffectLabel` builds the same text without markup. | `triggerEffectDisplay.ts:42-166` |
| **V1 editor.** A windowed, drag-sortable list of `TriggerV1Data` rows. Add appends a `start` trigger. Row delete asks `removeConfirm`. Each row has a name, a type (start, output, input, manual), conditions and effects. A new condition is `{type: 'value', value: '', operator: 'true', var: ''}`. A new effect depends on the row type: a `start` row gets `systemprompt`, any other `setvar`. **A condition or effect type change replaces it with a type-change template** that drops every old key; for example a `value` condition gets `operator: '='`. Warnings: `invaildTriggerEffect` and `triggerLowLevelOnly`. | `TriggerV1List.svelte:29-123`; `TriggerV1Data.svelte:46-125, 171-316, 333-351` |
| **Classic modes.** `v1Enabled` is true unless row 0's first effect is `triggercode`, `triggerlua` or `v2Header`, so an **empty list shows the V1 editor** and a pressed V1 button. The V1 button shows while `v1Enabled` or `showDeprecatedTriggerV1`. A `triggerlua` list shows the Lua editor, a `v2Header` list the V2 editor, everything else (**`triggercode` included**) the V1 editor. | `TriggerList.svelte:18, 29-42, 94-108` |
| **Classic mode switch.** It asks `triggerSwitchWarn` (for Lua only on a non-empty list), then **rechecks** that the bound list is the same array with the same first-effect type (`isWarnedList`), and does nothing otherwise. It replaces the whole list with a template: V1 `[]`; V2 the header row plus `New Event`; Lua one `start` trigger holding one `triggerlua` effect. | `TriggerList.svelte:22-25, 29-92` |
| **Lua editor.** A `TextAreaInput` on `value[0].effect[0].code`, a popup code editor (hotkey or long press) in language `lua`, and a Help button to the fork wiki's Lua page. The popup is one global modal (`popUpEditorStore`). The opener copies its value in, polls until the modal closes, and takes the value back. In `lua` mode the popup has no preview. | `TriggerList.svelte:97-101`; `lib/UI/GUI/TextAreaInput.svelte:75-113`; `lib/Others/PopupEditor.svelte:43-53, 77-98`; `ts/stores.svelte.ts:179` |
| **The engine's Low Level reading is truthiness of the raw value.** It reads `char.lowLevelAccess ?? false`, writes it into each trigger for the run, and tests `if(!trigger.lowLevelAccess)`. A module's flag works the same way. | `triggers.ts:1113, 1129-1136, 1606`; `process/modules.ts:993-1003` |
| **A character can hold a non-boolean flag.** Card import stores `risuext?.lowLevelAccess ?? false` unchanged, after asking on a truthy value. Studio's registry row for the character flag is `bool` without `keepForeign`, so `readHeld` reads `1` or `"true"` as **absent**, and `engineOn` reads absent as off. | `characterCards.ts:791-792, 1747-1750, 1824`; `ts/studio/history/fieldRegistry.ts:28, 132`; `edit/studioSetters.ts:180-183`; `edit/riskyFlags.ts:33-36` |
| `toPlainJson` walks `Object.keys`, so it keeps key order. It omits `undefined`, maps a non-finite number to `null` and `-0` to `0`, and throws on a bigint or a cycle. | `ts/storage/store2/codec/normalize.ts:35-93` |
| The character scripts tab shows only for `type === 'character'`, never for a group. It holds 배경 HTML, the regex list (S6), the trigger list, and **CharacterJS** (`virtualscript`), which shows while the value is **truthy** or `showUnrecommended` is on. | `lib/SideBars/CharConfigPanel.svelte:804-847` |
| `virtualscript` is never executed. Card imports write it as `''` ("removed due to security issue"), and `stores.svelte.ts:115` copies it into `simpleCharacterArgument`. | `characterCards.ts:1813, 2067, 2724`; Grep `virtualscript` under `src/ts`, tests excluded: 12 matches (2 in JSON fixtures), COMPLETE for that pattern, no executor |
| The module trigger tab mounts `TriggerList` on `module.trigger` (optional) with `lowLevelAble={module.lowLevelAccess}`. S5 holds the flag's only Studio editor. | `ModuleMenu.svelte:410`; `process/modules.ts:51-53`; S5 §1.3 |
| A blank character starts with the V2 template. `characterFormatUpdate` seeds `backgroundHTML ??= ''`. | `ts/characters.ts:1038, 1143-1157` |
| Studio shows the scripts kind (one item while the list is not empty) and the 배경 HTML kind (one item while the text is not blank). The scripts kinds and the character 배경 HTML kind are read-only through `itemText`, with the classic link. `scriptModeOf` reads `triggercode` as `lua`, and its comment says both "run as Lua in the engine"; the engine row above refutes that for this build. | `ts/studio/ownerModel.ts:252-283, 337-348, 374-383`; `itemText.ts:120-158`; `classicLinks.svelte.ts:41-65`; `scriptMode.ts:10-20`; `lib/Studio/StudioDetail.svelte:225-240, 309-314` |
| The registry has no `backgroundHTML` (character), `virtualscript` or trigger path. The S5 module rows exist. `keepForeign` is set on new rows only. | `history/fieldRegistry.ts:28, 68-135, 91-92` |
| The module writer has a foreign branch; the character writer `writeHeld` does not. | `studioSetters.ts:440-464, 653-664` |
| The asset merge rewrites trigger text in place on a character and copy-on-write on a module, as `textSet` on `trigger/<i>/<conditions\|effect>/<j>/<field>`. For Lua code it only sets a flag. | `assets/referenceTargets.ts:195-215, 251-279`; `studioSetters.ts:506-523, 701-714` |
| `routeOf` sends `trigger/...` to `{kind: 'text'}` and a `TEXT_FIELD_PATHS` entry to a `set`. `backgroundHTML` is a merge target (`referenceTargets.ts:341, 351`) but is not in `TEXT_FIELD_PATHS`, which three tests pin as a frozen literal. | `history/historyModel.ts:85-116, 919-939, 1044-1053`; `fieldRegistry.test.ts:76`; `historySetPaths.test.ts:57`; `historyModel.s1TextFields.test.ts:83` |
| `placeFocusAfterHistory` in `historyFocus.ts` places focus after a history action, and that file is not history-core. | `ts/studio/historyFocus.ts:133-160` |
| The CBS preview renders only `previewHtml`: strict DOMPurify with no `style`, no media, no URIs and no non-inert attributes. It renders on a sandbox that never calls `ParseMarkdown` or `processScriptFull`. | `longText/previewSanitize.ts:13-19, 44-69`; `longText/previewSandbox.ts:1-9` (inherited from draft 2) |
| History store: 4 MiB store cap, 2 MiB per owner. Studio history never reaches the `.bin`. | `history/studioHistoryStore.ts:16-25`; `history/tests/studioStoreBin.test.ts:1-11` |

## 1. Scope

### 1.1 In and out

**In** (MC-3983):
- **The scripts kind (스크립트) of a character and a module.**
  - Native Studio editors for all three modes:
    - Lua;
    - V2: every one of the 101 V2 types, that is the 98 pickable ones in their 12 categories plus the three structural ones;
    - V1: every condition type and effect shape, with classic's add and type-change templates.
  - The mode switch, import and export.
  - Every effect and row that runs is shown as running, whatever editor it sits in: as its own row, or in a note that says it runs (3.2 to 3.4, 3.7). That includes row 0 of a V2 list, which classic hides (Gate 1 R4-2).
  - The Low Level Access status the editors depend on, read-only here (3.6).
  - For a character, CharacterJS (MC-4113).
- **The character 배경 HTML kind:** `backgroundHTML`.
- History, the save chip, restore-to-open and changed-elsewhere behaviour, as in the other Studio forms.
- **No classic link remains** on the character and module scripts kinds or on the character 배경 HTML kind once the last stage lands (MC-4110; section 7).

**Out, each with its owner:**
- The regex list on the same classic tab: S6, #684.
- `lowLevelAccess` editing: S2 (character, built) and S5 (module, built). This kind reads the flag and never writes it (S5 §1.3).
- Module list operations: #709 (MC-3985). The interim link on the module 배경 HTML kind (S5 §1.3) belongs to S5 and #709.
- Group chats: classic has no scripts tab for a group (`CharConfigPanel.svelte:804`).
- Module `cjs`: not a ModuleMenu field (S5 §1.1); every write keeps it.
- Running or testing a script from Studio: classic has no such feature, and Studio never executes script content (section 5).
- **Classic's trigger editors are not changed** (MC-777 simpler path, Gate 1). Studio's pure modules are new code, pinned to classic by goldens recorded from the real classic component (TS10, TS11).
- Repairing unreadable lists: a follow-up ticket (E-a).
- Drag-and-drop reorder: a follow-up ticket (D8, the MC-4080 precedent). Move up / down reaches every position a drag reaches, one row at a time (3.4).

### 1.2 Classic parity (MC-4030, MC-4043)

| Classic feature (source) | Studio after #708 | Stage |
|---|---|---|
| Mode switch V1/V2/Lua, templates, recheck (`TriggerList.svelte:22-92`) | Mode chips, same templates, ask per D3, recheck at confirm (3.2) | SC-3 |
| V1 button: shown while the list is V1 or empty, or `showDeprecatedTriggerV1` is on | Same rule; the flag is read only (app-wide, MC-4043) | SC-3 |
| Empty list shows the V1 editor | Same (3.2) | SC-3 (empty state), SC-11 (editor) |
| `triggercode` list shown in the V1 editor | Read-only legacy-code view (D13, 3.2) | SC-3 |
| Lua code, popup code editor, Help (`:97-101`) | LT field, "Open in code editor" and Help (D4) | SC-3 |
| V2 event list: add, delete (multi-select, never the last), move, copy and paste above, rename cascade, Trigger On, keyboard without Delete | Native event list (3.3); drag is D8 | SC-4 |
| V2 effect list: rows, Edit of every known effect, delete (unwrap), move, copy (block copy), paste above (on `v2EndIndent` too), insert above (on `v2EndIndent` too) | Native effect list (3.4) | SC-4, SC-5 |
| Effects of other kinds shown as raw type text | Shown by kind, with what runs (3.4) | SC-4 |
| V2 type picker: categories, `checkSupported`, Deprecated | Native picker (3.5); Deprecated per D9 | SC-5 |
| V2 per-type forms for the 98 pickable types, `addElse`, the Else toggle on edit (`:2944-4079`) | Native effect sheet, data-driven per type, with a draft and Cancel (classic edits live) | SC-5 to SC-10 |
| V2 export and import (`:505-542, 2563-2585`) | Same file shape; one step; asks per MC-4111; mode rechecked at plan time | SC-3 |
| V1 rows, conditions, effects, add and type-change templates, warnings | Native V1 editor (3.7) | SC-11 |
| `lowLevelAble` gating and warnings | Same rules, from the engine's raw truthiness (3.6) | SC-3, SC-5, SC-10, SC-11 |
| Low Level Access switch | A status line here; the editor is in S2/S5 | done |
| Character 배경 HTML (`CharConfigPanel.svelte:807-808`) | 배경 HTML form (3.8) | SC-1 |
| CharacterJS (`:844-847`) | Text field behind classic's truthy gate, latched once shown (3.9) | SC-3 |
| `showDeprecatedTriggerV2` toggle inside the V2 picker | Not written by Studio (MC-4043); D9 shows Deprecated without it; lane A item for classic retirement (section 15) | — |
| Popup-editor hotkey and `longPressToPopupEditor` | App-wide, they stay in Settings (MC-4043); a button instead (D4) | — |
| The regex list | S6 | #684 |

## 2. Data and persisted shape (MC-175, MC-223, MC-350)

- **No persisted shape changes.**
  - Studio writes only `character.triggerscript`, `module.trigger`, `character.backgroundHTML` and `character.virtualscript`, in the shapes classic writes.
  - `.bin` and `.risum` round trips are unchanged, and nothing is fork-only.
- **Every new value equals what classic writes for the same action.**
  - Studio's pure modules live under `src/ts/studio/edit/`:
    - `triggerTemplates.ts`: the mode templates and the V1 add and type-change templates;
    - `triggerV2Defaults.ts`: the V2 defaults;
    - `triggerV2Blocks.ts`: the block rules;
    - `triggerOps.ts`: the step builders.
  - Classic's components are not changed. Goldens recorded from the real classic component in jsdom pin the modules to classic (TS10, TS11). Fixtures are built from the modules once they are pinned (MC-329).
  - **Copies.** Paste, import and restore copy with `toPlainJson`, which keeps key order (§0); never with canonical JSON.
    - Classic copies with `safeStructuredClone` or pushes the parsed objects as they are.
    - The two agree on every value a JSON file or a JSON save can hold. They differ only on values a save cannot hold anyway: `toPlainJson` drops `undefined`, writes a non-finite number as `null` and `-0` as `0`, and refuses a bigint or a cycle. A refused copy writes nothing and shows the step's refusal line.
- **Unknown keys are kept** on a trigger row (including the per-trigger `lowLevelAccess`), on a condition and on an effect.
  - A V2 effect edit writes the existing effect object with only the form's keys changed. It never writes an object rebuilt from the form's fields.
  - **One exception, as in classic:** a V1 condition or effect type change replaces the element with classic's type-change template, which drops the old keys (3.7).
- **The module list may be absent** (`trigger?`). It then reads as empty, and the first insert creates it.
- **MC-350:** no storage-format change and no migration. The Studio history record (device-only) is widened (4.5). Older builds refuse such a record whole and set it aside (MC-1827).

## 3. Studio design

### 3.1 Kinds, items and mounts

| Owner | Kind | Item rule (unchanged) | Form (new) | Root `data-part` |
|---|---|---|---|---|
| Character | `scripts` | one item while the list is not empty | `StudioScriptsForm` | `studio-scripts-form` |
| Module | `scripts` | same | `StudioScriptsForm` | `studio-scripts-form` |
| Character | `html` | one item while the text is not blank | `StudioCharacterHtmlForm` | `studio-char-html-form` |

- Each form mounts on the **kind**, as S5's forms do, so an empty list or blank text can be edited.
- Mount conditions follow S5 §2.1:
  - a character form needs `owner.type === 'character' && !owner.restricted && !owner.stub`;
  - a module form needs `openableModuleId !== null && !moduleIdShared`.
  - A shared module id mounts the same form read-only, with `studioRefusalModuleSharedId` (MC-1639).
- While a form is mounted, these kinds suppress `studio-detail-text`, `studio-detail-truncated` and `studio-detail-readonly`. The classic link goes with SC-1 on 배경 HTML and with SC-12 on the scripts kinds (section 7).
- Forms read the live owner on every render and never keep the mounted object (S5 F8). A module form reads by id at its slot; a shared view reads only its slot (S5 G5).

### 3.2 The scripts form: header, modes, Lua, mode switch

**Invariant I-S1.** No Studio component binds to a live trigger list or to any object inside it.
- Every change is a builder step through the history service (4.3).
- A sheet's draft, and the popup editor's text, are plain copies.
- Why: an editor bound to the live list would write without a step, a mark or a save, and dirty tracking would miss it (AGENTS.md). Classic's effect form edits the live object (§0); Studio's must not.

**Header (all modes):**
- Mode chips Lua / V2 / V1 (`studio-scripts-mode`, `-mode-lua`, `-mode-v2`, `-mode-v1`).
  - The chip of the current mode is `aria-pressed`. On an empty list the V1 chip is pressed, as in classic.
  - The V1 chip shows while the list is V1 or empty, or `showDeprecatedTriggerV1` is on (classic's `v1Enabled || flag`).
- The Low Level Access status line (3.6).
- In V2 mode, Import and Export (3.10).

**Body:**

| Live list | Body |
|---|---|
| empty | The V1 editor's empty state, as in classic, with the hint `studioScriptsModeEmpty`. Before SC-11 lands, only the hint and the chips. |
| row 0's first effect is `triggerlua` | **Lua view.** An LT field (`studio-scripts-lua`) in mode `plain`, with no token chip and no preview, on `list[0].effect[0].code`.<br>"Open in code editor" (`studio-scripts-lua-editor`) opens the popup editor (below).<br>Help (`studio-scripts-lua-help`) opens `FORK_WIKI_LUA_SCRIPTING_URL`.<br>**The extra notes** (one shared part with the legacy view): extra rows, or extra effects in row 0, show `studio-scripts-extra` with `studioScriptsExtraRows(n)` and `studioScriptsExtraEffects(n)`, saying they **still run** and are kept. They are never written or dropped. |
| row 0's first effect is `triggercode` | **Legacy view (D13): the Lua view with the code field read-only.** The code shows as read-only plain text (`studio-scripts-legacy-code`) with its own note, `studioScriptsLegacyCode`: this code type runs nothing in this build (§0). **The same extra notes** show under it. Row 0's other effects still run: row 0 starts with script code, so it is checked on every trigger, whatever Trigger On says, and its conditions still apply (§0). The other rows run as usual (Gate 1 R3-3). No chip is pressed, and the Lua and V2 chips switch with the usual ask, and the V1 chip does while it shows (`showDeprecatedTriggerV1`; classic's `v1Enabled` is false here). |
| row 0's first effect is `v2Header` | The native V2 editor: event list (3.3), effect list (3.4), effect sheet (3.5).<br>**Header note (Gate 1 R4-2).** When row 0 holds more effects after its `v2Header`, `studio-scripts-extra` shows `studioScriptsHeaderEffects(n, on)`: the hidden first row holds n more effects, they run when its Trigger On fires and its conditions hold, and they are kept. Row 0 is still never edited here. |
| anything else | The native V1 editor (3.7), with `triggerV1Warning` above it |
| the list or row 0 is unreadable | E-a′ (section 7) |

- Studio reads the mode where classic does. `scriptModeOf` keeps returning `lua` for `triggercode`; the form tests the first effect itself to tell the two apart. `scriptModeOf` reads only `list[0]?.effect?.[0]?.type`, so it gives a list that is not an array, or an unreadable row 0, a mode instead of refusing it; the form and every plan therefore test those first (E-a′; T1 in 4.3). SC-3 corrects `scriptModeOf`'s comment.

**Lua edits.** `buildLuaEdit(list, code)` is one `objSet effect` on row 0, whose value is row 0's effect array with only `[0].code` replaced.
- Coalescing follows S7 §4.2: the same list, index, field and label field within `COALESCE_MS`.
- Label: `{action: 'edit', field: 'lua'}`.

**Popup code editor (D4).**
- **On open**, the form keeps row 0's anchor and effect array, and the code it hands to `popUpEditorStore` (language `lua`).
- **On close**, if the text differs from the code at open, the form plans one `objSet effect` on row 0, with that `before` and `anchorBefore` and the same label as typing.
  - Within `COALESCE_MS` of Lua typing it merges into the typing step, as S7 §4.2 merges any such step. The merged step keeps the first `before` and anchor, so it stays exact (Gate 1 E4).
  - A refusal (row 0 changed while the popup was open) writes nothing and shows `studioScriptsChangedElsewhere`; the popup's text is dropped (D2, K9).
  - If the owner is gone, the form has unmounted, or another owner or kind is selected, the close writes nothing (MC-3896 analog).
- An unchanged close writes nothing.

**Mode switch (D3).**
- A tap on the chip of the current mode writes nothing and asks nothing, as in classic (`TriggerList.svelte:34, 49, 75`; Gate 1 R5-E1).
- **Refused while any row is not seam-holdable (Gate 1 N3, R3-4).** *Seam-holdable* means a plain object: S7 R1 lets no op touch any other row, and a switch must remove every row. The chips show `studioScriptsUnreadableBlocks`, and nothing is written. A row that is seam-holdable but not *editor-readable* (a plain object without array `conditions` and array `effect`; E-a) does not block the switch: the switch removes it with the others, and the item keeps it unchanged. The E-a follow-up ticket covers repair.
- On any other non-empty list it asks once: sheet `studio-scripts-mode-confirm`, with `studioScriptsModeAskTitle` and `studioScriptsModeAskBody(n)`, Cancel first and focused. **At ask time** the form keeps the whole list's fingerprint (`listFingerprint`) and n.
- **At confirm**, if the live list's fingerprint differs from the one at ask time, it writes nothing and shows `studioScriptsChangedElsewhere`. This is classic's `isWarnedList` recheck, made exact, and an instance of T3's "starts from the mode it was offered in" (4.3). Otherwise one step lands:
  - `objRemove` of every row, highest index first, all tagged with one new `deletedId` D and **all carrying span `list`**. The old list becomes one `list` item (4.3).
  - Then `objInsert` of the template rows in ascending order, untagged.
  - Label: `{kind: 'obj', list: 'trigger', action: 'replace', name: <mode>, count: n}`.
- An empty list switches without asking. The V1 template is `[]`, so choosing V1 on an empty list writes nothing.
  - Choosing Lua or V2 lands one step of untagged template inserts, which lists no item. An absent module list is created by the first insert and deleted again by the step's undo (N3).
  - The builder plans only while the live list is still empty; otherwise it writes nothing and shows `studioScriptsChangedElsewhere` (T3's "offered in").
  - The step holds no `list` run, and T4 needs none (Gate 1 R4-1).

### 3.3 V2 event list (native)

- A windowed list (`studio-scripts-events`) of rows 1..n (`studio-scripts-event-row`). Row 0 is never shown.
  - No event builder writes index 0. Only the mode switch and the restore of a `list` item touch row 0 (T3, 4.3).
- **Each row** shows:
  - the name: `comment`, or `sidebarUi.unnamedTrigger` when empty;
  - the Trigger On label;
  - a row menu (`studio-scripts-event-menu`): Move up / down / to top / to bottom, Copy, Paste above, Delete. Menu items carry `data-action` naming the action.
  - **A row for which `runsOnEveryTrigger` holds** (its first effect is `triggerlua` or `triggercode`; 3.4) also shows the every-trigger marker `studioScriptsEveryTrigger` (`studio-scripts-every-trigger`). The engine considers such a row on every run, whatever its Trigger On (§0). The wording does not say Lua, because a `triggercode`-first row runs its other effects the same way (Gate 1 R3-3).
- **Row 0 is not a row of this list, but its effects are not hidden.** The header note of 3.2 shows above the list whenever row 0 holds more effects after its `v2Header` (Gate 1 R4-2). Classic hides row 0 entirely.
- **Selection mode** (`studio-scripts-select-toggle`) works like classic's shift-select: checkboxes on rows, Delete (`studio-scripts-selection-delete`) and Copy (`studio-scripts-selection-copy`) for the selection, and `sidebarUi.nSelected`.
- **Keyboard on a focused event (D10, as classic):** arrows move the selection; Alt+↑/↓ moves the event; Ctrl+C copies; Ctrl+V pastes above. **Delete is not bound for events**, as in classic.
- **Add event:** `studio-scripts-event-add`.
- **The selected event's detail:**
  - The name input (`studio-scripts-event-name`). It lands one step on blur or Enter when the draft differs. Enter during IME composition is ignored, as in S5 §4.1.
  - Trigger On (`studio-scripts-event-on`): a select of the six types. An unknown stored type shows as `studioScriptsOtherType(value)` and is written only when the user picks a value, as in S6 E5.

| Action | Builder (`edit/triggerOps.ts`) | Ops in one step | Label |
|---|---|---|---|
| Add event | `buildEventAdd` | `objInsert` of `{comment: '', type: 'manual', conditions: [], effect: []}` at the end (classic `:2553-2558`) | `add` |
| Delete event(s) | `buildEventDelete` | One tagged `objRemove` per row, highest index first, all carrying span `v2`. Refused when it would leave no event (classic `:1698-1724`). No ask (DD-100); toast `studioScriptsEventDeleted(name, n)` with Undo. | `delete`, `count` |
| Move | `buildEventMove` | Untagged `objRemove` plus `objInsert` (S7 §2.5); never to or from index 0 | `move` |
| Copy | none (clipboard only, D5) | — | — |
| Paste above | `buildEventPaste` | One `objInsert` per copied row **before** the selected event (classic `:1689-1693`), as `toPlainJson` copies | `duplicate`, `count` |
| Rename | `buildEventRename` | `objSet comment` on the row, plus `objSet effect` on each row from index 1 on whose `v2RunTrigger` target named the old name (classic `:2601-2615`; its loop starts at 1, so row 0 is never touched) | `edit`, `field: 'comment'`, `name`: the new name |
| Trigger On | `buildEventType` | `objSet type` | `edit`, `field: 'type'` |

### 3.4 V2 effect list (native)

**Rows.**
- The selected event's effects (`studio-scripts-effects`), one row per effect (`studio-scripts-effect-row`), each indented by `safeIndent(indent)`.
- Add at end: `studio-scripts-effect-add`. Paste at end sits in the same area, when the clipboard holds effects.
- **Every row is classified by `effectKindOf(type)`.** The classes, and every "runs" or "doesn't run" text, are derived from two pure predicates that mirror the engine (§0). They live in one shared module, `ts/studio/edit/triggerKinds.ts` (Gate 1 N5, R3-3):
  - **`hasEngineCase(type)`** is true exactly for the 101 V2 types, the 15 V1 effect types and `triggerlua`: the types the engine switch has a case for. It is false for `triggercode` and for any other value.
  - **`runsOnEveryTrigger(row)`** is true exactly when the row's first effect is `triggerlua` or `triggercode`: the engine's filter bypass.
  - **One source for the type sets (R3-E5):** `KNOWN_V2_TYPES` and `V1_EFFECT_TYPES` in `ts/studio/assets/referenceTargets.ts`, exported there by SC-2a and read by `triggerKinds.ts`. SC-0 reads no type set, because restore acceptance uses the recorded span (4.3), never row content.
  - A row's text says it runs exactly when `hasEngineCase` holds, and says it runs nothing exactly when it does not.

| Kind | Which types | `hasEngineCase` | Shown as | Menu |
|---|---|---|---|---|
| `v2` | `KNOWN_V2_TYPES` | yes | Summary text from `effectSummaryParts`. A `checkSupported`-rejected effect shows `language.triggerDesc.v2UnsupportedTriggerDesc`, as classic does. | below |
| `lua` | `triggerlua` | yes | Read-only code text (`studio-scripts-effect-lua`) with `studioScriptsEffectLua`: it runs as Lua when this event runs, with the owner's Low Level Access | Insert above, Paste above, Move up / down, Copy, Delete |
| `legacy` | `triggercode` | no | Read-only code text with `studioScriptsEffectLegacy` (`studio-scripts-effect-legacy`): this app does not run it | same |
| `v1` | `V1_EFFECT_TYPES` | yes | `studioScriptsEffectOtherMode('V1', type)` (`studio-scripts-effect-other`): a V1 effect that runs when this event runs; Studio edits it only in a V1 list | same |
| `unknown` | any other type | no | `studioScriptsUnknownEffect(type)` (`studio-scripts-effect-unknown`): this app does not know it and runs nothing for it | same |

- Every value is shown as text (section 5).

**Menus of `v2` rows:**

| Row | Menu |
|---|---|
| a V2 type other than `v2Header`, `v2Else` and `v2EndIndent` | Edit, Insert above, Paste above, Move up, Move down, Copy, Delete |
| `v2Header` inside an event (classic-made or imported) | Insert above, Paste above, Move up, Move down, Copy, Delete. **No Edit:** it has no fields and no spec (Gate 1 R3-E5). |
| `v2Else` | Insert above, Paste above, Delete. Classic also offers Edit (only `noConfig`) and Copy (does nothing); Studio leaves both out. |
| `v2EndIndent` (shown as a block end) | Insert above, Paste above: how a first child goes into an empty block, as with classic's double click and paste |

- **Effects that `checkSupported` rejects stay editable,** as in classic. Only the picker filters by `checkSupported`.

**Summaries are text, never HTML.**
- A new pure function `effectSummaryParts(effect, context)` in `triggerEffectDisplay.ts` returns the segments `formatEffectDisplay` builds: the template text from `language.triggerDesc`, and each value with its tone.
- The row renders them as text nodes with theme classes. Studio's trigger UI has no `{@html}` (section 5).
- `formatEffectDisplay` and `formatEffectLabel` stay as they are for classic.

**Every effect action is one `objSet effect` on the event's row,** labelled `{action: 'edit', field: 'effect', name: <event name>}`. The new array comes from `triggerV2Blocks.ts`, and each function equals classic's result for the action named:

| Studio action | Function | Classic action it equals |
|---|---|---|
| Add at end | `appendEffect(effects, effect, {addElse})` | Save with no effect selected (`:3978-3999`): the default at indent 0; a block opener's `v2EndIndent` with `endOfLoop`; with `addElse`, the Else pair |
| Insert above row i (any row, `v2EndIndent` included) | `insertEffectBefore(effects, i, effect, {addElse})` | Picker from row i, then Save (`:4000-4021`): **the target's indent**; the opener's `v2EndIndent` without `endOfLoop`; the Else pair in classic's order |
| Edit row i | `replaceEffect(effects, i, edited, {addElse})` | Save of the edit form (`:4022-4079`): the edited object at i; for an If, the Else pair added or removed |
| Delete row i | `deleteEffect(effects, i)` | Remove (`:1530-1558`): a block opener unwraps its block |
| Copy row i | `copyEffects(effects, i)` | Copy (`:1560-1581`): a block opener copies its block; `v2Else` is not offered |
| Paste above row i, or at end | `pasteEffects(effects, i \| length, copied)` | Paste with row i selected, or with none (`:1630-1667`): the indent from `getInsertIndent`; a block rebased whole |
| Move up row i | `moveEffect(effects, start, start - 1)` | Drag of row i onto row `start - 1` (`:1939-2000`) |
| Move down row i | `moveEffect(effects, start, end + 2)` | Drag of row i onto row `end + 2`, or onto the end when `end + 2` equals the length |

- `start` and `end` are `getBlockRange(i)`: the row itself for a single effect, the whole block (Else included) for an opener.
- A move is offered only where classic's `canMoveEffect` allows it. The indent comes from `getInsertIndent`, as in a drag. One row at a time, Move up / down therefore reaches every position a drag reaches, into and out of blocks.
- **Alt+↑/↓ runs Move up / down.** That is wider than classic's Alt rule, which only swaps two same-indent, non-block neighbours (`:2065-2109`). On such neighbours both give the same array on a well-formed list (TS11).
- **Keyboard on a focused effect (D10):** arrows, Alt+↑/↓, Ctrl+C, Ctrl+V (paste above) and Delete, as in classic.

### 3.5 V2 effect sheet and type picker (native, data-driven)

- **The sheet** (`studio-scripts-effect-sheet`, with `-title`, `-picker`, `-category`, `-deprecated`, `-fields`, `-else`, `-save`, `-cancel`) is a bottom sheet on the phone and a centred dialog from `sm`, with its own Back layer.
- **The picker** comes first when adding or inserting.
  - It lists the categories in classic's order. Each category lists the types `checkSupported` allows for the selected event: the owner flag (3.6), the `display`/`request` allow lists, Special.
  - Labels come from `language.triggerDesc[type]` and `language.triggerCategories`. Deprecated follows D9.
- **Fields.** A pure table `V2_EFFECT_SPECS` (`ts/studio/edit/triggerV2Specs.ts`) gives each type's category, its field list in classic's order, and each field's kind and label key.
  - A new effect starts as `v2DefaultEffect(type)`, which TS10 pins to classic's default.
  - A type with no fields shows `noConfig`, as in classic. That is the six types of §0, plus `v2GetLorebookCount`, whose `outputVar` classic never shows; Studio follows classic (TS33 (d) names the exception).
  - The Else toggle (`-else`, `studioScriptsAddElse`) shows for `v2If` and `v2IfAdvanced`, like classic's `addElse`.
- **Field kinds** (`StudioTriggerField.svelte`; one `studio-scripts-field` per field, with `data-field` naming the key):
  - `text`;
  - `longText` (LT plain, compact);
  - `varName`;
  - `operand`: a value field plus its `<field>Type` select (`value`/`var`), with classic's `operandName` label;
  - `enum`: fixed options with classic's labels;
  - `bool`;
  - `eventName`: the other events' names, for `v2RunTrigger`;
  - `number`, where classic uses a number.

  A category stage that meets a binding none of these covers adds a kind in its own diff and names it.
- **Save** lands one step (3.4). **Cancel**, Back, Esc or a tap on the scrim discards the draft and writes nothing.
  - The draft is a plain copy (I-S1). Classic edits the live object and has no cancel; Studio's draft and Cancel are a deliberate difference.
  - One Save is one step, like classic's Save button.
- **Changed elsewhere while the sheet is open.** Save plans against the live list, with the row's anchor and effect array taken when the sheet opened. A refused plan closes the sheet, drops the draft and shows `studioScriptsChangedElsewhere` (D2, MC-3896 analog).

### 3.6 Low Level Access in this kind

- **Reading (Gate 1 F1):** `lowLevelOn(owner) = Boolean(raw)`.
  - `raw` is the live holder value: the character's `lowLevelAccess`, or the module's `lowLevelAccess`. It is read directly, not through the registry reader or `engineOn`.
  - This is the engine's reading (§0): `1`, `"true"` and even `"false"` read as on.
  - The character flag's registry row cannot take `keepForeign` (`fieldRegistry.ts:28`).
- **Status line** `studio-scripts-lowlevel`:
  - it shows `studioScriptsLowLevelOn` or `studioScriptsLowLevelOff`;
  - its button `studioScriptsLowLevelChange` (`studio-scripts-lowlevel-change`) calls `selectStudioNode(ownerKey, 'advanced', null)`, which opens S2's risky section or S5's 위험한 설정.
  - There is no switch here: each flag has one editor, and the risky guard stays the only way to turn the flag on (MC-3980, MC-3984).
- **Users of the reading:** the picker, the V1 warnings, the `lua` effect note, and the MC-4111 import ask. Effects that need the flag while it is off stay, can be edited, and show classic's warnings; the engine skips them (`triggers.ts:1606` and after).
- **Cross-ticket note (out of scope):** S2 reads the character flag through the registry reader, so a stored `1` shows as off there, and a turn-on over it asks again. That over-asks and never under-asks. Section 15 hands it to lane A.

### 3.7 V1 editor (native)

- A windowed list (`studio-scripts-v1-list`) of rows (`studio-scripts-v1-row`), with Add row (`studio-scripts-v1-add-row`). Each row has:
  - a name (`comment`);
  - a type: the four V1 types classic offers. A stored `display` or `request` shows as `studioScriptsOtherType`;
  - conditions (`studio-scripts-v1-conditions`; add with `studio-scripts-v1-condition-add`; `always` when there are none);
  - effects (`studio-scripts-v1-effects`; add with `studio-scripts-v1-effect-add`; `noEffect` when there are none);
  - warnings (`studio-scripts-v1-warning`): `invaildTriggerEffect` and `triggerLowLevelOnly`, under classic's conditions (`TriggerV1Data.svelte:333-351`) and the 3.6 reading.
- **Effect rows are classified by `effectKindOf`, as in 3.4.**
  - `v1` effects are edited through the specs.
  - A `v2` effect shows `studioScriptsEffectOtherMode('V2', type)`; `lua`, `legacy` and `unknown` effects show as in 3.4.
  - Effects that are not `v1` can be deleted and moved, not edited.
  - A row for which `runsOnEveryTrigger` holds shows the every-trigger marker `studioScriptsEveryTrigger` (`studio-scripts-every-trigger`), as in 3.3.
- **Adds use classic's templates** (`edit/triggerTemplates.ts`):
  - a row: `{comment: '', type: 'start', conditions: [], effect: []}` (`TriggerV1List.svelte:116-121`);
  - a condition: `{type: 'value', value: '', operator: 'true', var: ''}`;
  - an effect: `systemprompt` on a `start` row, else `setvar` (`TriggerV1Data.svelte:171-190`).
- **A condition or effect type change** replaces the element with classic's type-change template (`TriggerV1Data.svelte:101-125, 209-316`) and drops its other keys, as classic does.
- **Row delete:** a tagged `objRemove` carrying span `v1`, with **no ask** (DD-100) and a toast with Undo. Classic asked `removeConfirm`; Studio follows DD-100 because the delete can be undone and restored. A delete of the last row also carries `v1`, so an emptied V1 list lists an ordinary `v1` item.
- **Row move:** the row menu and Alt+↑/↓ (D8).
- **Every field edit is an `objSet` on the row.** `comment` and `type` are set directly. A condition or effect change is `objSet conditions` or `objSet effect` with the edited array. Text fields commit on blur, selects on change. The label is `edit` with the field.
- **The mode stays V1 (T3, design default D16).** A V1 plan whose result would change the list's mode is refused with `studioScriptsModeWouldChange` and writes nothing. Only lists that already mix kinds reach it:
  - deleting or moving row 0 when the next row starts with `triggerlua`, `triggercode` or `v2Header`;
  - moving such a row to index 0;
  - deleting or moving effects of row 0 so that one of those types comes first.

  Classic lets these edits flip the mode silently. Ordinary V1 edits (comment, type, conditions, a V1 effect add or type change) never change row 0's first effect type to one of those, so they pass.
- The V1 forms use the field kinds of 3.5, driven by `V1_EFFECT_SPECS` and `V1_CONDITION_SPECS` (`ts/studio/edit/triggerV1Specs.ts`).

### 3.8 Character 배경 HTML form

- One field: label `backgroundHTML` with Help, and an LT field in mode `html+cbs` (`studio-char-background`), with no token chip and the hint `studioCharHtmlHint`.
- It follows S5's html section. The build generalises that component or adds `StudioCharacterHtmlForm`, whichever keeps S5's tests unchanged (D6).
- Edits go through `editText(owner, 'backgroundHTML', value, 'typing')`.
- Absent and foreign values follow S5 §2.5 (`studioModAdvValueForeign`).
- Preview: the strict LT preview (section 5).

### 3.9 CharacterJS (MC-4113)

- A plain-mode LT field (`studio-scripts-charjs`) in the character scripts form, below the trigger editor, with `studioScriptsCharjsNote` under it.
- **Gate, as in classic:** shown while the stored value is **truthy** or `showUnrecommended` is on. The setting is read only.
- **Latch (D12, the `StudioAdvancedForm.svelte:106-114` precedent):** once shown, the field stays mounted until the owner or kind changes.
- A truthy foreign value (not a string; `keepForeign: true`) shows `studioModAdvValueForeign`, as in S5 §2.5. The first edit writes a string, and undo writes the foreign value back.
- Registry row `virtualscript` (4.2). No preview.

### 3.10 Import, export, clipboard (V2 mode)

- **Export** (`studio-scripts-export`) writes `list.slice(1)` as pretty JSON, named `triggers-<time>.json`, through the app's existing download path (the build names it). It lands no step.
- **Import** (`studio-scripts-import`) reads a JSON file.
  - Acceptance is classic's: an array whose every element has `comment`, `type`, an array `conditions` and an array `effect`. Otherwise nothing is imported, and `studioScriptsImportNone` shows (`:513-530`).
  - Rows are `toPlainJson` copies. Effects of any kind are kept and shown by 3.4.
  - It lands one step of `objInsert` per row at the end, with label `import` and the count, and the toast `studioScriptsImported(n)`.
- **Timing (MC-4111; Gate 1 F3 and N4).**
  - **When the picker opens**, the form keeps row 0's anchor (the `v2Header` row).
  - Nothing is decided while the file picker or the file read is open. After the file is parsed:
    1. If the owner is gone or the form has unmounted, nothing is written.
    2. If row 0 is no longer the row whose anchor was kept (the list changed mode or was replaced elsewhere), nothing is written, and `studioScriptsChangedElsewhere` shows. This recheck is an instance of T3's "starts from the mode it was offered in" (4.3). T3's after-check then holds by construction, because the import appends after row 0.
    3. Otherwise the form reads the flag by 3.6. When it reads on and the file adds at least one row, it asks: sheet `studio-scripts-import-confirm`, with `studioScriptsImportAskTitle`, `studioScriptsImportAskBody(name, n)` and `studioScriptsImportAskConfirm`, Cancel focused. Cancel writes nothing.
    4. The step is planned at confirm, or at once when there is no ask. Checks 1 and 2 run again first.
- **Clipboard (D5).**
  - It lives in memory only, holds `toPlainJson` copies, and is scoped to the owner and mode it was copied in.
  - Paste is offered only there and never asks.
  - Copying across owners is not a classic feature and is not offered.

### 3.11 States

| State | Scripts form | 배경 HTML form |
|---|---|---|
| Loaded, history ready | Editable | Editable |
| History loading, or another page holds the owner | Read-only (`aria-busy`): lists shown, menus and sheets disabled, LT read-only | LT read-only |
| Module stub, refused load | No kinds (inherited). The module-level `studioOpenModules` belongs to #709. | n/a |
| Shared module id | Read-only lists and Lua text, with `studioRefusalModuleSharedId` | n/a |
| Unreadable rows (E-a, E-a′) | A row that is not editor-readable is an inert marked row. The mode switch and a `list` restore are refused (`studioScriptsUnreadableBlocks`) only while a row is not seam-holdable (R3-4). The whole list is inert when row 0 is not editor-readable, and every plan is refused when the list is not an array (D14, T1). | n/a |
| Write refused at write time | The section's refusal line (`refusalTextOf`) | Refusal line; the control returns to the live value |
| Changed elsewhere | The lists re-read live. An open sheet's Save, a pending mode switch, a pending import and a popup close are refused, as in 3.2, 3.5 and 3.10. | LT's existing behaviour |
| Owner gone | The owner-gone flow clears the selection. An open sheet or confirm closes and its draft is dropped; a later popup close or import writes nothing (MC-3896 analog). | Same |
| Confirm pending (mode, import) | Sheet open; nothing written | n/a |
| Between SC-4 and SC-10 only | A type whose category stage has not landed shows its summary and `studioScriptsEffectPending` (`studio-scripts-effect-pending`): it can be moved and deleted, not edited. This interim state exists only on `main`, because the fork has not shipped (MC-089). | n/a |

### 3.12 Layout

- **Phone (360-412, Android first):**
  - one column;
  - the V2 editor has two levels, the event list and then the selected event's detail and effects, with Back returning to the list (DD-098);
  - sheets are bottom sheets; targets are `min-h-11`;
  - nothing scrolls horizontally.
- **768:** the same two levels.
- **1280:** the event list and the event detail side by side, at the S4 §9 form width (D7).
- Theme tokens only.
- **Theme packs:** ordinary `studio-*` part names, and no new guard, invariant or protected part against a pack hiding, covering or restyling these forms (MC-3638).

## 4. History, undo and save

### 4.1 The trigger list in the S7 seam (rows appended to S7's tables)

| S7 table (S7 §4.1a) | `trigger` row |
|---|---|
| `ObjListName` | `'trigger'` |
| `OBJ_LIST_HOLDERS` | character → `triggerscript`; module → `trigger`; no session kind |
| `OBJ_LIST_FIELDS` | `comment` (text); `type` (text, any string kept); `conditions` (**array**, the whole container); `effect` (**array**, the whole container). Each accepts `{had:false}` on either side.<br>Label-only field: `lua`.<br>`objSet` never sets any other key (the per-trigger `lowLevelAccess`, unknown keys), and every op keeps them. |
| `OBJ_LIST_IDENTITY` | `content` only (as for regex) |
| Anchor-excluded keys | none |
| `OBJ_PROPS` | none |
| Asset-merge prefix (R5) | `trigger/` |
| Message keys | `studioScriptRestoreLine`, `studioScriptRestoreChanged`, `studioScriptRestoreEarlierVisit`, `studioScriptRestoreTaken`, `studioScriptRevertMixed`; mode refusal `studioScriptRestoreModeDiffers`; T3 refusal `studioScriptsModeWouldChange`; unreadable refusal `studioScriptsUnreadableBlocks` |
| **Span (new column, N9; replaces draft 4's `whole`)** | required on every tagged trigger `objRemove` / `objInsert`: `list`, `v1` or `v2`. Never on an untagged op, never on another list (4.3). |
| **Planner checks (new column, N9)** | T1 (a non-array list refuses), T4 (a `list` run is the whole list) and "a `v2` run never names index 0", on every route (4.3) |
| **Restore rule (new column, N9)** | `triggerRestoreRule` (4.3) |
| **Deleted-item presentation (new column)** | `studioScriptDeletedList(mode, n)` for a `list` item; `studioScriptDeletedRows(name, n)` for a `v1` or `v2` item (Gate 1 E6) |

**Labels (Gate 1 F8).** S7's label is `{kind: 'obj', list, action, name, count?, field?}`, strictly parsed. The trigger list uses S7's actions and adds exactly one:

| Studio step | `action` | other keys |
|---|---|---|
| Lua edit, popup close | `edit` | `field: 'lua'` |
| Mode switch | **`replace`** (appended to `ObjAction`) | `name`: the new mode; `count`: rows removed |
| Import | `import` | `count` |
| Add event / V1 row | `add` | `name` |
| Delete event(s) / V1 row | `delete` | `name`, `count` |
| Move | `move` | `name` |
| Paste events | `duplicate` | `count` |
| Rename | `edit` | `field: 'comment'`; `name`: the new name (the old name is not stored) |
| Trigger On, V1 type | `edit` | `field: 'type'` |
| Any V2 effect action | `edit` | `field: 'effect'`; `name`: the event's name |
| V1 condition or effect change | `edit` | `field: 'conditions'` or `'effect'` |
| Restore from History (also the inverse replace) | S7's `{kind: 'restoreDeleted', deletedId}` | — |

A build with S7 but without #708 refuses `list: 'trigger'`, `replace` and `span` whole (MC-1827 (a), S7 R8).

### 4.2 Registry rows (append-only, `fieldRegistry.ts`)

| Path | `property` | value | holders | absent | editWhenAbsent | keepForeign | labelKey | focus `{form, part}` |
|---|---|---|---|---|---|---|---|---|
| `backgroundHTML` | (none) | text | character | delete | true | true | `backgroundHTML` | `studio-char-html-form` / `studio-char-background` |
| `virtualscript` | (none) | text | character | delete | true | true | `charjs` | `studio-scripts-form` / `studio-scripts-charjs` |

- **Bare paths.** Path, property and merge target are the same string, so the converters stay the identity (S5's reasoning for `backgroundEmbedding`).
- **`backgroundHTML` joins `TEXT_FIELD_PATHS`** (the router). Without it, a merge step is a `textSet` the restore point never learns about, and a form edit next to a merge records the wrong `before`. The three frozen-literal tests (§0) are amended on purpose. `virtualscript` is not a merge target and does not join.
- **`writeHeld` gains the foreign branch:** a `{had: 'foreign'}` value assigns a fresh `toPlainJson` copy, as S5 E11 did for modules.
- Both paths join the character's derived restore row.

### 4.3 Steps, coalescing, undo, restore

- **Every trigger step** goes through the history service's object-list intent from S7-0.
  - A character writes through `writeLiveCharacter`, in place.
  - A module writes through `writeLiveModule`, copy-on-write, as one slot assignment.
  - S7's rules apply unchanged: all-or-nothing `planObjStep`, anchors, `content` counts, the tag rule for deleted items, `already` by witness.
- **Coalescing:** Lua typing and a popup close coalesce (one `objSet effect` on row 0, label field `lua`). Event names, effect sheets and V1 text fields each commit one step.
- **Undo, redo, revert and Restore from History** work as they do for lore and regex, with the span, T1 to T4 and the restore rule below.
  - Header Undo stops at a step that was changed elsewhere (`precondition`).
  - History's single-step undo goes past it.

**Invariants and closure for the trigger list (MC-4114; Gate 1 N1 to N4, R3-1, R3-2; senior-advisor direction).** These add list-specific invariants to S7 §4.0's I1 to I5 and change none of them. Gate 1 round 5 is asked to attack the cells of the closure table and of the empty-list and row-0 trace below (section 15).

*Terms.*
- **Mode** of a live list: `scriptModeOf` (`lua` covers `triggercode`).
- **Seam-holdable row:** a plain object. This is S7 R1's boundary: no op may name another row.
- **Editor-readable row:** a seam-holdable row with array `conditions` and array `effect` (E-a).
- **Whole restore:** the restore of a `list` item (below).
- The first predicate gates the mode switch and the `list` restore. The second gates row menus and editors only (R3-4). Both live in `ts/studio/scriptMode.ts`.
- **Live span** of a list, used by the restore rule (`liveSpanOf`): `v2` when the mode is `v2`; `v1` when the mode is `v1` or `empty`; none when the mode is `lua`, or row 0 is not editor-readable.

**Span: one required key, replacing draft 4's `whole` flag and its content classes.** Every tagged `objInsert` / `objRemove` on `list: 'trigger'` carries `span`. Untagged ops and other lists never do.
- `list` is written by:
  - the removes of a mode switch (3.2);
  - the removes of the live list in an inverse replace (E, below);
  - the inserts that restore a `list` item.
- `v2` is written by the removes of an event delete (3.3), and `v1` by the removes of a V1 row delete (3.7), including one that empties the list. Each is the live mode at build time. No builder deletes rows in the Lua or legacy view, so no other value exists.
- The inserts that restore a `v1` or `v2` item carry the item's span.
- **Parser rules.** All ops sharing one `deletedId` in a step carry the same span. The parser refuses:
  - a run whose ops disagree;
  - a tagged trigger op without `span`;
  - `span` on an untagged op or on another list;
  - a value other than `list`, `v1` and `v2`;
  - a `v2` run that names index 0 (no V2 builder touches the header).
- Inversion keeps `span`, as it keeps `deletedId`. A deleted trigger item carries the span of its ops, built from them like its entries (S7's "an item is complete from its ops"), and the item parser requires it.
- Span `list` is MC-4114's "`whole` item flag" under a wider key (section 12).

*Invariants.*
- **T1. The mode is a function of live row 0 only.** It is read by `scriptModeOf` and stored nowhere else. A trigger list that is present but not an array (E-a′) refuses every trigger plan, the restore rule included, with `studioScriptsUnreadableBlocks` (R3-E2). `scriptModeOf` would give such a value a mode (§3.2), so the planner tests it first.
- **T2. An item's span is a function of its tagged ops only, on every route.** No route reads row content or the label to decide it.
- **T3. Only two plans built now may change the mode: the mode switch and the restore of a `list` item.** Every other plan built now leaves the mode unchanged and, in V2, leaves row 0's anchor unchanged. Every plan built now, those two included, starts from the mode it was offered in.
  - "Built now" means every editor builder (3.2 to 3.7, 3.10), the import and Restore from History.
  - The two mode-changing plans are named by what builds them, not by their ops (Gate 1 R4-1). The mode switch counts whether the list is empty or not: an empty list's switch holds only untagged template inserts and no `list` run. The restore of a `list` item counts whether the live list is empty or not.
  - One shared pure helper, `checkTriggerModeKept(before, after, offeredMode)` in `ts/studio/scriptMode.ts`, checks both sides on the planned working list for every other plan. The builders and the restore rule do not restate it. `empty` counts as V1 on both sides. On failure the plan writes nothing and shows `studioScriptsModeWouldChange`.
  - The "offered in" half: the switch's confirm-time fingerprint (3.2; for an empty list, "still empty when planned"), the import's row-0 recheck (3.10), both showing `studioScriptsChangedElsewhere`; and, for a restore, the span acceptance below.
  - Builder-side T3 is design default D16.
  - **T3 is a build-time property.** Replays (undo, redo, `already`, revert, the restore line) apply recorded ops under S7 I3 and change the mode exactly as the recorded step did. They do not re-evaluate T3.
- **T4. A `list`-span run is the whole list.** A `list` remove run ends with the working list empty, and a `list` insert run starts with it empty. An absent list counts as length 0 (Gate 1 R5-E2). That is the whole planner check. It reads the runs' ops and the working list's length, never the mode (Gate 1 R4-1, option (a)).
  - The planner checks it on every route: commit, undo, redo, the `already` witness, revert and the restore line.
  - A replay of a non-empty switch, or of a `list` restore, after an outside append is therefore refused as changed elsewhere (`precondition`), and header Undo stops there. This replaces draft 4's K8 (section 11).
  - A plan with no `list` run passes T4 trivially. That includes an empty-list switch and its inverse. Their replay after an outside write is K6.

*Closure table (rows are routes).*

| Route | Span comes from | T4 (run emptiness only) | T3 (mode kept; offered in) | Listing and consuming |
|---|---|---|---|---|
| Builder commit, non-empty switch | the builder: `list` on every remove | planner: the removes end empty | exempt from "mode kept"; "offered in" by the confirm-time fingerprint | lists D from the ops (S7 tag rule) |
| Builder commit, empty-list switch | none: untagged template inserts only | no `list` run; passes | exempt from "mode kept"; "offered in": still empty when planned | lists nothing |
| Builder commit, any other builder | the live mode for a row delete; none on untagged ops | no `list` run; passes | shared helper, before and after | the tag rule on the step's ops (S7) |
| Restore from History | the item, copied onto its inserts; E's removes get `list` | planner | a `list` item: exempt from "mode kept"; a `v1` / `v2` item: live span equals item span, then the helper | lists E (when the live list is not empty) and consumes D, from the ops (N10) |
| Undo, redo | inversion keeps the key | planner; this is also the whole-list precondition draft 4's K8 lacked | not re-evaluated: recorded ops under S7 I3 | from the ops, whatever the label kind (N10) |
| `already` (the data save landed, the history save did not) | the step's forward ops | the witness plan runs the same check | not re-evaluated | what the applied route gives (N10) |
| Revert, restore line | inversion of the journal's ops | planner | not re-evaluated | from the ops (N10) |

*Empty-list and row-0 trace (Gate 1 round 4).* Each case on every route it reaches.

| # | Case | Route | What happens | Decided by |
|---|---|---|---|---|
| 1 | Empty or absent list switched to V2 or Lua | commit | one step of untagged template inserts; an absent module list is created by the first insert (N3); no item is listed | T3 (switch exempt; still empty when planned); T4 trivially |
| 2 | the same | undo, single-step undo, revert, restore line | the template rows go by anchor, untagged; the list returns to `[]`, or to absent when the step created it (N3) | S7 anchors; T4 trivially |
| 3 | the same | redo, `already` both ways | the same inserts or removes again; nothing is listed or consumed | S7 I3 |
| 4 | the same, with an outside append before the undo | undo | the template rows go by anchor; the appended row stays, and the list may then mix kinds | K6 (an outside write) |
| 5 | Empty list switched to V1 | commit | nothing is written (template `[]`) | 3.2 |
| 6 | Non-empty V2, Lua or legacy list switched to V1 (`showDeprecatedTriggerV1` on, so the V1 chip shows) | commit, undo | the `list` removes end empty and no insert follows, so the list is `[]`; undo's `list` insert run starts empty | T4 |
| 7 | The last V1 row deleted | commit, undo | span `v1`; V1 → empty passes (empty counts as V1); undo's insert run is `v1`, not `list` | T3, T2 |
| 8 | A `list` item restored into an empty or absent list | restore, undo, redo | no E; D's inserts start empty; the first insert creates an absent module list, and undo deletes it again | T4, N3 |
| 9 | A `v1` item restored into an empty list | restore | accepted by span; S7's clamp may put it at index 0; refused when the result's mode is not V1 | T3 after-check |
| 10 | A `v2` item restored into an empty list | restore | refused (the live span is `v1`) | span acceptance |
| 11 | Row 0 of a V2 list | every event builder, the rename, the import | no op names it; the rename cascade starts at row 1, as classic's does | T3 (anchor half) |
| 12 | Row 0 of a V2 list holding effects after its `v2Header` | display; every builder; switch | the header note says they run (3.2); no builder touches them; a switch removes row 0 with the rest into D | R4-2; T4 |
| 13 | Row 0 of a Lua or legacy list | Lua typing, popup close | one `objSet effect` on row 0 that changes only `[0].code`; the mode is kept | T3 |
| 14 | Row 0 of a V1 list | V1 edits | an edit that would flip the mode is refused | T3, D16 |
| 15 | Row 0 not editor-readable | switch; `v1` / `v2` restore | the switch is offered while every row is seam-holdable; `v1` / `v2` restores are refused (no live span) | R3-4, D14 |
| 16 | A list that is not an array | any plan | refused | T1 |

**Restore from History: `triggerRestoreRule` (MC-4114).** It is a pure function of the item and the live list, called at the one obj-restore site before planning. T1 applies first.
- **A `list` item restores as an inverse replace**, in one step labelled `{kind: 'restoreDeleted', deletedId: D}`:
  1. Tagged `objRemove` of every live row, highest first, under a fresh `deletedId` E that the caller supplies (N11), carrying span `list`. The current list becomes a `list` item E, so it is restorable in turn.
  2. Then `objInsert` of the item's rows, ascending at their stored indices, tagged D and carrying span `list`.

  When the live list is empty, step 1 has no ops and E is not listed. This works for any live mode, the item's own mode included (D15). The replaced rows are kept as item E, recoverable while E stays listed (K10).
  - It is refused with `studioScriptsUnreadableBlocks` while any live row is not seam-holdable (N3, R3-4).
- **A `v1` or `v2` item is accepted exactly when the live span equals the item's span:** a `v2` item into a V2 list; a `v1` item into a V1 or empty list. A Lua or legacy list, or a list whose row 0 is not editor-readable, accepts none. Otherwise the item is refused with `studioScriptRestoreModeDiffers`, which is then always true of it: it came from a list of another mode.
  - Indices keep S7's clamp. A `v2` item holds no index 0 (the parser refuses it), and a `v1` item never enters a V2 list, so the header stays at row 0 without a special clamp (N2; R3-E1 no longer arises).
  - T3's helper then runs on the result. A failure refuses with `studioScriptsModeWouldChange` and writes nothing. Example: a `v1` row whose first effect is `triggerlua`, landing at index 0 of a V1 list that was emptied since.
  - Row content is never classified for acceptance. A row of any content restores into its own mode and is refused in another (R3-1; MC-4114 as written). That covers a `triggerlua`-first event, an event holding only V1 effects, a V1 row holding a V2 effect and an effect-less row.
- **What the rules give.** No plan built now changes a list's mode unless it is the mode switch or the restore of a `list` item (T3), and a `list` run always covers the whole list (T4). Replays change the mode only as their recorded step did, or after an outside write (K6).
  - Lists that already mix kinds (made by classic, or by an import of such a file) are shown row by row with what runs (3.2, 3.4, 3.7).
  - A count note never hides runnable code without saying it runs.
- **Presentation in History (E6).**
  - A `list` item shows `studioScriptDeletedList(mode, n)`, for example "V2 rules: 12 triggers". `mode` is a localised label chosen from the item's own row 0, which the item holds: `studioScriptLua` for `triggerlua`, `studioScriptLegacy` for `triggercode`, `studioScriptV2` for `v2Header`, `studioScriptV1` otherwise. It is never the raw `scriptModeOf` value (Gate 1 R4-E5). The reused labels are "Lua script", "V2 rules" and "V1 triggers" (`en.ts:2511-2513`), so the template puts the label before a colon. The old V2 list and the replaced Lua list are therefore told apart.
  - A `v1` or `v2` item shows `studioScriptDeletedRows(name, n)`.

**Restore to when Studio opened (MC-4051).** The trigger list gets its own memory-only visit-journal line, "Scripts: undo n changes", with S7's tail-merge. No trigger list enters the stored restore point.

**Mixed revert.** A range holding both trigger obj ops and an asset merge's `textEdit` under `trigger/` is refused with `studioScriptRevertMixed` (S7 R5).

**Replays do not ask** (MC-4112; section 5).

**Focus after a history action:**
- the changed event is selected and its row focused;
- for an effect step, the effect row at the step's index when it exists, else the event detail;
- registry paths use their own focus targets.

`placeFocusAfterHistory` in `historyFocus.ts` places it, and that file is not history-core. If merged S7-0 routes obj focus through `ownerHistory.svelte.ts` or the service, SC-4 becomes ★ and runs alone.

### 4.4 Save and dirty tracking

- Character writes mark through `writeLiveCharacter`.
- Module writes replace the slot (`tracker.modules = true`, S5 §3.3).
- No component binds to the live list (I-S1), so nothing changes saved data without a step.
- The save chip is the existing per-owner one.

### 4.5 Stored history format (MC-1827, MC-350)

| Shape | New? |
|---|---|
| Obj ops and deleted items with `list: 'trigger'` on character and module records | yes |
| Field kind `array` on `objSet` values | yes, unless S7-0 already has it (N2) |
| Label action `replace`; label-only field `lua` (part of the trigger row) | yes |
| `span: 'list' \| 'v1' \| 'v2'` on every tagged trigger `objRemove` / `objInsert`, and on a trigger deleted item (derived from its ops). It replaces draft 4's `whole`. | yes |
| The creation record (N3; Gate 1 R5-E2): `created: true` on the `objInsert` that creates an absent module `trigger` list, and on its inverse `objRemove`. It rides on the op, so inversion, the journal, revert and the restore line carry it, and the inverse remove deletes the property when it leaves the list empty. It applies to `list: 'trigger'` only; other module-held lists keep merged S7-0's behaviour, so the cost to older builds stays that of the trigger row. | yes |
| Registry paths `backgroundHTML`, `virtualscript` | yes |

- The version stays 2. Older builds refuse each new shape whole, and the set-aside keeps the bytes (MC-1827 (c)). No migration.
- **Cost of `span`.** It appears only on `list: 'trigger'` ops and items, which any build without #708 already refuses whole. So it costs older builds nothing beyond what the trigger row costs.

### 4.6 What this spec needs from merged S7-0 (N1 to N11)

| # | Need | If merged S7-0 lacks it |
|---|---|---|
| N1 | Per-list tables in `history/objectLists.ts` that the parser, planner and builders read (S7 R1-R8) | SC-0 cannot proceed; this spec is revised first |
| N2 | A field value kind for a whole plain JSON **array** (canonical equality, `{had:false}` allowed). S7 r6's `ObjFieldValue` names only `string`, `number`, `boolean`, `null` and `ObjEntry` (S7 §4.1). | SC-0 adds it (★) |
| N3 | Host writers that resolve the holder property from `OBJ_LIST_HOLDERS`: a character in place; a module copy-on-write, where an absent list reads empty and the first insert creates it. **The step that creates an absent list records that it did** (trigger list only; §4.5), so its inverse (undo, revert, the restore line) deletes the property again once the list is empty, and the bytes return exactly (MC-4030; Gate 1 R4-1, the new-module case). | SC-0 generalises them (★). If the merged seam cannot carry the `created` op key, K12 applies. |
| N4 | A service intent that takes any table list's builder ops and label | SC-0 adds it (★) |
| N5 | A journal, line and keys per list (S7 R4) | as N1 |
| N6 | A mixed-revert prefix per list (S7 R5) | as N1 |
| N7 | Coalescing of a one-`objSet` step by list, index, field and label field | SC-0 adds it (★) |
| N8 | `ObjAction` and the label parser as closed vocabularies | SC-0 appends `replace` (★) |
| N9 | Per-list table columns read by the parser, the planner, the tag rule and the Restore from History caller:<br>the **span** column: which tagged ops carry `span`, and the parser rules of 4.3 (required, uniform per run, never untagged, `v2` never at index 0); inversion and item construction keep it;<br>the **`created`** op key (N3, §4.5; trigger list only), which inversion keeps;<br>the **planner checks** T1, T4 (run emptiness only, never the mode; Gate 1 R4-1) and the `v2` index rule, on every route;<br>a **restore rule**;<br>the deleted-item presentation keys | SC-0 adds them (★) |
| N10 | **Listing follows the ops, whatever the label (R3-2).** On every route, the `already` move included, obj listing and consuming follow the tag rule on the step's tagged ops alone, whatever the label kind. A `restoreDeleted` step may hold a remove run tagged another id, E. It lists E on commit, redo and `already`-redo, and consumes E on undo and `already`-undo, while its insert run consumes and re-lists D in the usual way. Today's greeting paths handle `restoreDeleted` by label: on redo they consume the label's id and list nothing, and on undo they re-list only that id (`historyModel.ts:2771-2793`). A label branch on the obj path would therefore lose E. | SC-0 adds it (★) |
| N11 | **A fresh id for E.** The restore planner is pure, so the caller (the obj-restore site) supplies the fresh `deletedId` for E. | SC-0 widens the restore intent (★), or its Gate 1 plan names where E's id is minted |

- SC-0's Gate 1 plan rechecks N1 to N11 against the merged code and names each one that is missing.
- If merged S7-0 offers one table-driven path for extra op keys, `span` and `created` use it, with one mutant per touchpoint. If the seam's owner refuses list-specific keys on generic ops, SC-0's plan returns to this spec before building. (The fallback, a fixed span prefix in the trigger item's `deletedId`, hides stored-format meaning in an identifier and is not preferred.)
- If S7-0 is redesigned before it merges, section 4 is revised before SC-0 starts.
- SC-1 does not depend on the seam.

## 5. Security: display, confirmation, history

Scripts, Lua and HTML are executable content. Studio edits them as data and shows what runs.

**Display: never executed, never rendered raw, never mislabelled.**
- **Lua, legacy code and CharacterJS:** plain-mode text nodes, with no preview and no CBS run. The popup code editor in `lua` mode highlights and completes; it has no preview and runs nothing (§0).
- **V2 and V1 rows:** text segments from `effectSummaryParts` and plain labels.
  - Studio's trigger UI has **no `{@html}` anywhere**.
  - `indent` is used only as a coerced number in a style value (`safeIndent`).
  - Card-controlled strings (names, values, types, code) can never become elements.
- **What runs is labelled as running.** Every such label is derived from the two predicates of 3.4 (3.2, 3.3, 3.4, 3.7):
  - every effect row says it runs exactly when `hasEngineCase` holds: V2, V1 and `triggerlua` effects, wherever they sit;
  - every row for which `runsOnEveryTrigger` holds shows the every-trigger marker in the V2 and V1 views, with wording that does not claim Lua;
  - the Lua view and the legacy view show the same extra-row and extra-effect notes, which say those rows and effects still run.
  - the V2 view's header note says that row 0's effects after its `v2Header` run when that row's Trigger On fires (3.2; Gate 1 R4-2).

  Only `triggercode` and unknown types, for which `hasEngineCase` is false, are labelled as not running.
- **배경 HTML:** the LT `html+cbs` preview goes through `previewHtml` only. Raw HTML never reaches an `{@html}` sink in Studio.
- **No run or test from Studio.** No Studio code path calls `runTrigger`, `runScripted` or a Lua engine (TS26).

**Confirmation:**

| Action | Asks? | Source |
|---|---|---|
| Turning Low Level Access on (directly or by replay) | yes, the existing risky sheet, outside this kind | MC-3980, MC-3984 |
| Mode switch of a non-empty list | yes, once, with the count; rechecked at confirm | D3 (MC-4009 analog); classic `isWarnedList` |
| Import while the owner's flag reads on (3.6), decided after the file is parsed | yes | MC-4111 |
| Picking a Low Level effect | not offered while the flag reads off; no ask while it reads on | classic `checkSupported` |
| Delete of an event, a V1 row or an effect | no. Undo restores it, and History restores it into a list of the same script type (4.3). | DD-100 |
| Restore from History, the inverse replace included | no; the replaced list becomes a deleted item | MC-4112, MC-4114 |
| Paste (same owner and mode) | no | D5 |
| Typing in Lua, CharacterJS or 배경 HTML | no | classic parity |

**History and restore (MC-4112).**
- Undo, redo, revert, Restore from History and the restore line can put trigger code back, including Lua and low-level effects, without a question. Only the flag's own off→on asks (MC-3984).
- The case this leaves open is K2.
- The history store (device-only, never in `.bin`) holds copies of script text and never executes them.

## 6. Locale keys

Keys go into `en.ts`. Each PR carries its 7 other locales and passes `localeParity` (MC-058).

**Reused, no new text.** This list is PARTIAL: the category stages also reuse field labels from `triggerInputLabels`, and SC-11 the V1 labels below, adding no new text. Each stage checks that every key it uses exists.
- `scripts`, `triggerScript`, `help.triggerScript`, `triggerV1Warning`, `helpBlock`;
- `backgroundHTML`, `help.backgroundHTML`, `charjs`, `help.charjs`, `lowLevelAccess`;
- `studioScriptLua`, `studioScriptV2`, `studioScriptV1`;
- `import`, `export`, `cancel`, `copy`, `paste`, `edit`, `remove`, `add`, `name`, `type`, `value`, `uiCommon.save`, `uiCommon.delete`, `uiCommon.undo`;
- `triggerOn`, `triggerStart`, `triggerOutput`, `triggerInput`, `triggerManual`, `editDisplay`, `editProcess`;
- `sidebarUi.unnamedTrigger`, `sidebarUi.nSelected`, `sidebarUi.conditions`, `sidebarUi.effects`, `sidebarUi.deprecatedTag`, `triggerEffectCategory`;
- the whole `triggerDesc`, `triggerCategories` and `triggerInputLabels` objects; `triggerCond*`, `triggerEff*`, `triggerMatch*`, `triggerMatchMode`;
- V1: `always`, `noEffect`, `ifValue`, `ifChatIndex`, `varableName`, `searchDepth`, `truthy`, `equal`, `notEqual`, `greater`, `less`, `greaterEqual`, `lessEqual`, `isNull`, `extractRegex`, `runImgGen`, `cutChat`, and the other labels `TriggerV1Data.svelte` uses (SC-11 lists them);
- `invaildTriggerEffect`, `triggerLowLevelOnly`, `noConfig`;
- `studioModAdvValueForeign`, `studioRefusalModuleSharedId`.

**New: 55 keys.** `studioScriptStep` is one key holding an object.

| Key | English | Stage |
|---|---|---|
| `studioScriptRestoreLine` | (n) => `Scripts: undo ${n} changes` | SC-0 |
| `studioScriptRestoreChanged` | The scripts changed elsewhere since, so they're left as they are. Use History to undo single steps. | SC-0 |
| `studioScriptRestoreEarlierVisit` | Script changes since then aren't undone here. Use History to undo them. | SC-0 |
| `studioScriptRestoreTaken` | Can't restore: an identical trigger is already in this list. | SC-0 |
| `studioScriptRevertMixed` | This range includes an asset merge that changed trigger text, so it can't be reverted in one go. Undo steps one at a time. | SC-0 |
| `studioScriptRestoreModeDiffers` | Can't restore: these triggers came from a list of another script type. | SC-0 |
| `studioScriptDeletedList` | (mode, n) => `${mode}: ${n} triggers`, with plural forms; `mode` is a localised label (4.3) | SC-0 |
| `studioScriptDeletedRows` | (name, n) => `"${name}"` / `${n} triggers` | SC-0 |
| `studioScriptsModeWouldChange` | This change would turn the list into another script type, so it wasn't made. Use the script type buttons to change it. | SC-0 |
| `studioScriptLegacy` | Legacy script | SC-0 |
| `studioScriptStep` | Object of step labels by action: `Lua`, `Replace(mode)`, `Import(n)`, `Add(name)`, `Delete(name, n)`, `Move(name)`, `Duplicate(n)`, `Rename(name)`, `TriggerOn(name)`, `Effects(name)`, `Conditions(name)` | SC-0 |
| `studioCharHtmlHint` | Shown behind this character's chats. | SC-1 |
| `studioScriptsModeLabel` | Script type | SC-3 |
| `studioScriptsModeEmpty` | No scripts yet. Add a trigger, or choose another script type. | SC-3 |
| `studioScriptsModeAskTitle` | Change the script type? | SC-3 |
| `studioScriptsModeAskBody` | (n) => `The ${n} triggers here will be replaced. You can undo this.` (plural forms) | SC-3 |
| `studioScriptsModeAskConfirm` | Replace | SC-3 |
| `studioScriptsLowLevelOn` | Low Level Access is on: these scripts can call AI models and use other heavy features. | SC-3 |
| `studioScriptsLowLevelOff` | Low Level Access is off: effects that need it are kept but don't run. | SC-3 |
| `studioScriptsLowLevelChange` | Change in Advanced | SC-3 |
| `studioScriptsLuaEditor` | Open in code editor | SC-3 |
| `studioScriptsExtraRows` | (n) => `This list also holds ${n} other triggers. They still run, and they are kept as they are.` | SC-3 |
| `studioScriptsExtraEffects` | (n) => `This trigger also holds ${n} other effects. They still run: this trigger is checked on every trigger, whatever Trigger On says, and its conditions still apply. They are kept as they are.` | SC-3 |
| `studioScriptsLegacyCode` | This code is an old script type that this app doesn't run. It is kept as it is. Choose Lua to write a new script. | SC-3 |
| `studioScriptsUnreadable` | This list isn't a trigger list Studio can read, so it can't be edited here. It is kept as it is. | SC-3 |
| `studioScriptsUnreadableRow` | This item isn't a trigger. It is kept as it is. | SC-3 |
| `studioScriptsUnreadableBlocks` | This list holds data Studio can't read, so it can't be changed this way here. It is kept as it is. | SC-0 |
| `studioScriptsChangedElsewhere` | The scripts changed elsewhere, so this change wasn't saved. Showing the current scripts. | SC-3 |
| `studioScriptsImportAskTitle` | Import with Low Level Access on? | SC-3 |
| `studioScriptsImportAskBody` | (name, n) => `"${name}" has Low Level Access on, so the ${n} imported triggers can access AI models and your storage directly.` | SC-3 |
| `studioScriptsImportAskConfirm` | Import | SC-3 |
| `studioScriptsImported` | (n) => `Imported ${n} triggers` | SC-3 |
| `studioScriptsImportNone` | This file has no triggers Studio can import. | SC-3 |
| `studioScriptsCharjsNote` | This app never runs CharacterJS. It is kept as it is. | SC-3 |
| `studioScriptsEvents` | Events | SC-4 |
| `studioScriptsAddEvent` | Add event | SC-4 |
| `studioScriptsEventDeleted` | (name, n) => `Deleted "${name}"` / `Deleted ${n} events` | SC-4 |
| `studioScriptsMoveUp` | Move up | SC-4 |
| `studioScriptsMoveDown` | Move down | SC-4 |
| `studioScriptsMoveTop` | Move to top | SC-4 |
| `studioScriptsMoveBottom` | Move to bottom | SC-4 |
| `studioScriptsAddEffect` | Add effect | SC-4 |
| `studioScriptsInsertAbove` | Insert above | SC-4 |
| `studioScriptsPasteAbove` | Paste above | SC-4 |
| `studioScriptsPasteAtEnd` | Paste at the end | SC-4 |
| `studioScriptsUnknownEffect` | (type) => `"${type}" isn't an effect this app knows, so it doesn't run. It is kept as it is.` | SC-4 |
| `studioScriptsEffectLua` | Lua script: it runs when this event runs, with this owner's Low Level Access. | SC-4 |
| `studioScriptsEffectLegacy` | Old script type: this app doesn't run it. It is kept as it is. | SC-4 |
| `studioScriptsEffectOtherMode` | (kind, type) => `A ${kind} effect (${type}). It runs when this trigger runs (a Low Level effect only while Low Level Access is on); Studio edits it only in a ${kind} list.` | SC-4 |
| `studioScriptsEveryTrigger` | Starts with script code, so it is checked on every trigger, whatever Trigger On says. Its conditions still apply. | SC-4 |
| `studioScriptsHeaderEffects` | (n, on) => `This list's hidden first row also holds ${n} effects. They run when its Trigger On (${on}) fires and its conditions hold. They are kept as they are.`, with plural forms; `on` is the Trigger On label, or `studioScriptsOtherType(value)` | SC-4 |
| `studioScriptsEffectPending` | Editing this effect in Studio comes in a later stage. (Interim; SC-12 removes it.) | SC-4 |
| `studioScriptsOtherType` | (value) => `Other: ${value}` | SC-4 |
| `studioScriptsSelect` | Select events | SC-4 |
| `studioScriptsAddElse` | Add an Else branch | SC-5 |

Per stage: SC-0 12, SC-1 1, SC-3 21, SC-4 20, SC-5 1, total 55; SC-12 removes 1.
- Draft 5 renamed three keys (`studioScriptsExtraRows`, `studioScriptsExtraEffects`, `studioScriptsEveryTrigger`), reworded three (`studioScriptRestoreModeDiffers`, `studioScriptsLegacyCode`, `studioScriptsUnreadableBlocks`) and added one (`studioScriptsModeWouldChange`).
- Draft 6 rewords three (`studioScriptsExtraEffects`, `studioScriptsEveryTrigger`, `studioScriptsEffectOtherMode`; Gate 1 R4-E1) and adds two (`studioScriptLegacy`, R4-E5; `studioScriptsHeaderEffects`, R4-2).

SC-0 adds the restore, presentation, refusal and label keys because its table row names them, and S7's tables type keys as `StringKeyOf<languageEnglish>` (as `FIELD_PRESENTATION` does, `fieldRegistry.ts:61`), so `pnpm check` needs them there. SC-2b's builders and SC-11's notice reuse `studioScriptsModeWouldChange`.

## 7. Gone and replaced behaviour, error steps (MC-4030, MC-3896)

**Replaced:**
- **The read-only view and the classic link.** The `itemText` view, `studioReadOnlyNote` and the classic link go from the character and module scripts kinds and the character 배경 HTML kind (MC-4110). SC-1 removes them on 배경 HTML, with its form; SC-12 removes them on the scripts kinds, once every V2 category and V1 is native.
- **Mode switch warning.** Classic's "current triggers will be lost" becomes `studioScriptsModeAskBody`, because the switch can be undone and its list restored.
- **V1 delete.** Classic asked `removeConfirm`; Studio does not ask (DD-100: delete never asks; undo and History restore it).
- **Effect form.** Classic's edits the live object with no cancel; Studio's sheet edits a draft and has Cancel.
- **Effect display.** Classic's `{@html}` display becomes text segments. Classic showed raw type text for effects of other kinds; Studio shows them by kind, with what runs (3.4).
- **`triggercode` lists.** Classic showed them in the V1 editor; Studio shows them as read-only legacy code (D13).
- **`showDeprecatedTriggerV2`.** Classic wrote this app-wide setting from inside the picker; Studio never writes it (MC-4043) and shows Deprecated per D9.
- **Reorder.** Drag-and-drop becomes Move up / down (same reach, one row at a time) and Alt+↑/↓; drag is a follow-up ticket (D8). Classic's Alt+↑/↓ on effects swapped only same-indent, non-block neighbours; Studio's runs Move up / down (3.4).

**Gone-owner behaviour:** 3.11 (MC-3896 analog: notice, clear, drop the draft, write nothing).

**Error steps** (MC-4030 allows them with a follow-up):

| Id | When | What Studio does | Follow-up |
|---|---|---|---|
| E-a | **Row-level:** a row other than row 0 is not editor-readable (a plain object with array `conditions` and array `effect`) | That row is an inert marked row (`studio-scripts-unreadable-row`, `studioScriptsUnreadableRow`), with no menu and no op. Every other row stays editable (MC-4081 / MC-4050, S7 R1). **Only a row that is not seam-holdable** (not a plain object) blocks the mode switch and a `list` restore, with `studioScriptsUnreadableBlocks`. A seam-holdable row, for example one without `effect`, is removed by a switch and kept inside the item (R3-4). | **A new ticket (lane A files it):** "Studio: repair unreadable trigger lists", as #720 is for lore |
| E-a′ | **List-level (D14):** the list is not an array, or row 0 is not editor-readable | The whole list is inert (`studio-scripts-unreadable`, `studioScriptsUnreadable`): rows shown as text, no menus, no editor ops. A list that is not an array refuses every trigger plan (T1). An array list whose rows are all seam-holdable keeps the mode switch, so it can be replaced and its old content kept as a History item. `v1` and `v2` restores into it are refused (no live span). | same ticket |
| E-b | Module stub or refused load | No kinds; the module-level link belongs to #709 | #709 |
| E-c | Shared module id | Read-only view (MC-1639) | Lane A: whether #714 covers trigger lists |
| E-d | Private character | No kinds (inherited) | none |
| E-e | An effect that is not `v2` in a V2 list, or not `v1` in a V1 list | Shown by its kind with what runs (3.4, 3.7); kept, movable, deletable; not edited there | none |

## 8. Data-part census (new names, COMPLETE for this draft)

| Stage | Names | Count |
|---|---|---|
| SC-1 | `studio-char-html-form`, `studio-char-background` | 2 |
| SC-3 | `studio-scripts-form`, `studio-scripts-mode`, `studio-scripts-mode-lua`, `studio-scripts-mode-v2`, `studio-scripts-mode-v1`, `studio-scripts-lowlevel`, `studio-scripts-lowlevel-change`, `studio-scripts-import`, `studio-scripts-export`, `studio-scripts-unreadable`, `studio-scripts-unreadable-row`, `studio-scripts-charjs`, `studio-scripts-lua`, `studio-scripts-lua-editor`, `studio-scripts-lua-help`, `studio-scripts-extra`, `studio-scripts-legacy-code`; `studio-scripts-mode-confirm` with `-title`, `-body`, `-cancel`, `-ok`; `studio-scripts-import-confirm` with `-title`, `-body`, `-cancel`, `-ok` | 27 |
| SC-4 | `studio-scripts-events`, `studio-scripts-event-row`, `studio-scripts-event-menu`, `studio-scripts-event-name`, `studio-scripts-event-on`, `studio-scripts-event-add`, `studio-scripts-every-trigger`, `studio-scripts-select-toggle`, `studio-scripts-selection-delete`, `studio-scripts-selection-copy`, `studio-scripts-effects`, `studio-scripts-effect-row`, `studio-scripts-effect-menu`, `studio-scripts-effect-add`, `studio-scripts-effect-lua`, `studio-scripts-effect-legacy`, `studio-scripts-effect-other`, `studio-scripts-effect-unknown`, `studio-scripts-effect-pending` | 19 |
| SC-5 | `studio-scripts-effect-sheet`, `-title`, `-picker`, `-category`, `-deprecated`, `-fields`, `-else`, `-save`, `-cancel`; `studio-scripts-field` (one per field, `data-field` naming the key) | 10 |
| SC-11 | `studio-scripts-v1-list`, `studio-scripts-v1-row`, `studio-scripts-v1-add-row`, `studio-scripts-v1-conditions`, `studio-scripts-v1-condition-add`, `studio-scripts-v1-effects`, `studio-scripts-v1-effect-add`, `studio-scripts-v1-warning` | 8 |

**66 names, counting sub-parts; 65 after SC-12 removes `studio-scripts-effect-pending`.**
- Menu items are not parts. Each carries `data-action` naming its action, which tests drive.
- The theme-pack `areaParts` allow-list test may need entries. It is a guard file and may need an exact grant (ownership.md).

## 9. Required tests

**Classes** (gates.md; lane A's ruling of 2026-11-24 allows no fourth label):
- **R**, regression reproducer: fails on the named base, on an assertion about the intended defect or the missing behaviour.
  - Import, setup and missing-export failures do not count.
  - Where only a module is missing, the stage runs the test once against a stub that returns nothing and shows the assertion failing.
- **C**, compatibility guard: may pass before and after; the row says so.
- **D**, diagnostic.

Every R is **DESIGNED, NOT DEMONSTRATED** until the build shows its pre-fix failure.

**Bases:**
- SC-1: `main` at the branch point (2099bea7a, or the rebased base the stage names).
- SC-0, SC-2a, SC-2b and SC-3: "S7-0 merged" plus the previous stage.
- SC-4 onward: "the previous stage merged".

**Fixtures (MC-329)** are built by their producers:
- characters from `createBlankChar`.
- **Classic goldens (SC-2a):** recorded by driving the real, unchanged `TriggerList`, `TriggerV2List` and `TriggerV1Data` components in jsdom through their own menus, buttons, keys and drop handlers.
  - If an action cannot be driven in jsdom (for example a drop needing a `DataTransfer` jsdom lacks), SC-2a copies that function verbatim from the base commit into a test-only oracle module (`src/ts/studio/edit/tests/classicTriggerOracle.ts`) and names each copied function in the test file.
  - App code never imports the oracle.
- Lua, V1 and V2 values from the Studio modules once TS10 pins them.
- A Lua character as `Agents/Tools/save-gen/make-chat-scene-fixture.mjs` builds it.
- Modules through the module import decoder and `applyModulePlacement`.
- An import file as classic's export writes it. A mixed file (a `triggerlua` effect inside an event, a Lua row, V1 effects) as classic's import accepts it: an export edited the way a user or another app would.
- Asset-merge text through the real merge commit.
- A crafted card through the card import decoder: trigger strings, a `lowLevelAccess` of `1` or `"true"`, a foreign `backgroundHTML` or `virtualscript`, rows without `effect`, and mixed V1 lists (a row starting with `triggerlua`, a row holding a V2 effect). `characterCards.ts:1824` keeps the flag raw, and `:1810` keeps `triggerscript` verbatim. The build names the decoder entry point. A synthetic fixture is allowed only where the decoder normalises the value, and the row says so.
- Non-object rows (`"x"`, `null`) through classic's import, which pushes elements verbatim (S7 R1).

Sanitizer and display assertions run in jsdom, with an identity-sanitizer falsification (MC-239).

| Id | Scenario | Class | Base and expected failure | Fixture |
|---|---|---|---|---|
| TS1 | `editText(char, 'backgroundHTML', …)` lands one `set` step; undo restores; the form edits it | R | main: refused (path unregistered); no form | `createBlankChar` after `characterFormatUpdate` |
| TS2 | Router: edit then merge, and merge then edit, of `backgroundHTML`. The restore point learns both, and each `before` is right. | R | Stage-internal "rows without the `TEXT_FIELD_PATHS` entry": the merge is a `textSet` the point misses | real merge commit after an opening edit |
| TS3 | Foreign `backgroundHTML` (a number): the note shows, the first edit writes a string, undo writes the number back | R | Stage-internal "without the `writeHeld` foreign branch": undo leaves the string | card import body |
| TS4 | Update-All on 배경 HTML lands the same text | C | passes before and after | toggle text |
| TS5 | Frozen facts: two rows appended, existing rows unchanged; the `TEXT_FIELD_PATHS` literals in the three pinning tests amended on purpose | C | named contract change | existing |
| TS6 | CharacterJS: edit and undo. Shown when the value is truthy (a string or foreign) or `showUnrecommended` is on, which is never written. A foreign value shows the note, and undo writes it back. Clearing to `''` with the setting off keeps the field mounted (latch). | R | main: refused, no field | crafted card through the decoder, else synthetic |
| TS7 | **Kind acceptance and the span.** Trigger ops and items parse on character and module records and are refused whole on chat records. A parser with only S7-0 refuses `list: 'trigger'`, `replace` and `span`. **Refused:** a tagged trigger op without `span`; `span` on an untagged op or on another list; a run whose ops disagree on `span`; a value other than `list`, `v1` and `v2`; a `v2` run naming index 0; a trigger item without a valid `span`; `created` on another list or on a character record. **Accepted:** `created: true` on the `objInsert` that creates an absent module `trigger` list and on its inverse (N3, §4.5; Gate 1 R5-E2). An item can outlive its steps, so "an item's span equals its ops'" is tested on items the service builds instead (TS15b, MS51; Gate 1 R4-E4). **The planner refuses** (T1, T4): any plan on a list that is not an array; a `list` remove run that does not end with the list empty; a `list` insert run that does not start with it empty. It never refuses a plan for changing the mode (MS67). | R / C / D | Acceptance half: R on "S7-0 merged" (refused). The refusal rows are C on that base (refused there for another reason); MS64 and MS58 make them fail. The S7-0-only half is D (scratch checkout). | records written by the #708 service; for the refusals, copies of them edited in exactly the named key |
| TS8 | `objSet effect` with an array round-trips the parser and `diffEntry`/`applyEdits`; an own `__proto__` key and depth > 8 are kept | R or C | R if S7-0 lacks N2, else C (the build records which) | as TS7 |
| TS9 | Lua typing coalesces to one step; undo restores the code; unknown keys, the per-trigger `lowLevelAccess`, extra effects and extra rows survive | R | S7-0 merged: no builder | Lua template plus extras |
| TS10 | **Golden pin of values:** for every pickable V2 type, `v2DefaultEffect(type)` deep-equals what classic's picker creates, key order included. The mode templates, the V1 add templates and the V1 type-change templates equal classic's. | C (goldens vs classic, before and after: classic is unchanged) / R (Studio modules) | The golden half passes before and after. The Studio half is R on "SC-2a with stub modules returning `{}`". | classic in jsdom |
| TS11 | **Golden pin of block rules.** A fixed corpus of effect arrays: well-formed, nested and empty blocks, Else pairs, and malformed arrays (a missing `v2EndIndent`, wrong or non-number indents, a stray `v2Else`). Each 3.4 action runs on each array: append; insert above every row, `v2EndIndent` included; edit with the Else toggle both ways; delete every row; copy, and paste above every row and at the end; Move up and down every row. Classic's resulting array is recorded once as a golden, and Studio's function must deep-equal it. Alt+↑/↓ equals classic's swap on same-indent non-block neighbours of well-formed arrays. | C (recorder vs classic) / R (Studio functions) | The recorder half passes before and after. The Studio half is R on "SC-2a with stub functions returning the input". | classic in jsdom, or the verbatim oracle where named |
| TS12 | Event actions: add; multi-delete (never the last event, never row 0); move; paste above (key order kept); rename with the `v2RunTrigger` cascade; Trigger On. Each is one step with the ops and label of 3.3, and undo and redo restore the bytes. The Delete key on a focused event does nothing; on a focused effect it deletes. | R | SC-3 merged: no event list | `createBlankChar` with three events, one of them a `v2RunTrigger` |
| TS13 | I-S1: an effect sheet opened, edited and cancelled leaves `DBState` untouched and unmarked. Save gives exactly one step and one mark. A later outside edit does not change an open draft. | R | SC-4 merged: no sheet | `createBlankChar` |
| TS14 | Module host: one slot replacement per step, every other key kept (the S5 every-key fixture); an absent `trigger` reads empty, the first insert creates it, and the undo of that step deletes it again, so the module's bytes equal those before (N3). **Outside append (lane A P1):** an absent module list switched to V2, then one event appended by classic's Add event, then header Undo: the two template rows go, the appended event stays, and `trigger` is still present; the same over the restore line and over revert (MS71). Stub and shared id refused. | R | S7-0 merged | S5 T5-KEYS fixture; a module without `trigger`; the outside append by the real classic `TriggerV2List` Add event in jsdom |
| TS15 | Mode switch. It asks only when the list is non-empty; Cancel writes nothing; confirm is one step whose removes all carry span `list` and list one `list` item; undo restores the bytes. A list changed while the sheet is open (an outside append, or an outside edit of one row) writes nothing at confirm and shows `studioScriptsChangedElsewhere`. V1 on an empty list writes nothing, and the V1 chip shows on an empty list. **Empty list (R4-1):** an empty character list and an absent module list, each switched to Lua and to V2: one step of untagged template inserts, and no item is listed. Undo restores `[]`, or the absent property, byte for byte. Redo, a single-step undo, the `already` move both ways and the restore line give the same bytes as the applied route. A list that became non-empty before the tap is refused with `studioScriptsChangedElsewhere`. **Pressed chip (R5-E1):** a tap on the chip of the current mode writes nothing and asks nothing, for V2, Lua and a non-empty V1 list. **Predicates (R3-4):** a list with a non-object row: the chips refuse with `studioScriptsUnreadableBlocks`, nothing is written, and no op names that row. A list with a plain-object row without `effect`: the switch is offered, removes that row with the others, and item D holds it unchanged. | R | S7-0 merged. The empty-list rows are also R on a stage-internal planner that keeps draft 5's T4 mode clause: there they are refused (MS67). | templates; a character list emptied by the V1 switch (the test turns `showDeprecatedTriggerV1` on; Studio never writes it); a module without `trigger`; a non-object row through classic import; a row without `effect` through the card import decoder |
| TS15b | **Restore across modes (MC-4114), the span and T1 to T4.** SC-0 drives these with ops shaped as 3.2 to 3.7 specify; SC-2b re-runs them through the builders.<br>(1) V2 → Lua, restore the V2 item D: one step; the V2 list is back whole; the Lua list is item E, span `list`.<br>(2) Lua → V2, restore the Lua item: likewise.<br>(3) A V2 event deleted (span `v2`), then V2 → Lua, restore the event: refused with `studioScriptRestoreModeDiffers`, nothing written.<br>(4) A V1 row deleted, emptying the list, then restored: accepted; the item's span is `v1`.<br>(5) After (1), restore E: the Lua list returns whole, and the V2 list becomes a new `list` item (round 2 N1 scenario 2).<br>(6) Switch, Undo, Redo, then restore D: accepted as an inverse replace (round 2 N1 scenario 1).<br>(7) Undo of (1)'s restore: D is listed again with span `list`, and E is consumed; restore D again: accepted.<br>(8) The restore line across a switch and a whole restore returns the visit-start bytes, and History lists the same items, with the same spans, as before.<br>(9) V1 `[A (no effects), B]`; delete A; switch to V2; restore A: refused with `studioScriptRestoreModeDiffers`, nothing written (round 2 N2; MC-4114 as written).<br>(10) One V2 multi-delete of an event `[v2SetVar]` and an event `[setvar]` (one item, span `v2`): restored into its own V2 list, accepted; the same item after a switch to V1, or to Lua, refused.<br>(11) A `list` restore while a live row is not a plain object: refused with `studioScriptsUnreadableBlocks`. While a live row is a plain object without `effect`: accepted, and that row is inside E unchanged.<br>(12) History shows a `list` item as `studioScriptDeletedList` with its localised mode label (a `triggercode` list as `studioScriptLegacy`) and its count, and an event item as `studioScriptDeletedRows`.<br>(13) After (1), header Undo then Redo: E is listed again with span `list`, D is consumed, and the bytes equal those after (1) (R3-2).<br>(14) The `already` move on (1)'s step, in both directions (the data save landed, the history save did not): the listing equals what the applied route gives (R3-2).<br>(15) T3 after a restore: a V1 list `[R0, R1]` whose R1 starts with `triggerlua`; delete R1, then R0; restore R1. S7's clamp puts it at index 0, which would make the list Lua, so it is refused with `studioScriptsModeWouldChange`, and nothing is written.<br>(16) T4 on replay: switch; an outside append of one row; header Undo: refused as changed elsewhere, and the list is unchanged and not mixed. Likewise Redo after Undo and an outside append. | R | Stage-internal base: SC-0 with the trigger row but without the span, the restore rule, the T3 helper and the T4 check (S7's plain restore and replay). On it, (1), (2) and (5) to (7) give a two-header or Lua-plus-events list; (3), (9) and (10)'s second half are accepted; (15) flips the mode; (16) leaves a mixed list. (13) and (14) are guards where the seam already lists from the ops; MS59 and MS60 make them fail. | templates; classic import for (11)'s non-object row; crafted card through the decoder for (11)'s row without `effect` and for (15) |
| TS15c | **Same-list restores of rows of any content (R3-1 scenarios A to C).** (A) A V2 event `[v2SetVar, triggerlua]`; its `triggerlua` moved up; the event deleted and restored: accepted at its index, and the list stays V2. (B) An event `[v2SetVar, setvar]`; `v2SetVar` deleted; the event deleted and restored: accepted. (C) A V1 row holding a V2 effect, deleted and restored into its V1 list: accepted. | C | Passes on the stage-internal base (S7's plain restore accepts each) and after. It guards against draft 4's content classes, which refused all three in their own list (MS53). | classic import of a mixed file for (A) and (B); crafted card through the decoder for (C) |
| TS15d | **Property run (T3, T4).** Seeded random sequences of event and V1 deletes, mode switches (of empty lists included), Restore from History, header Undo and Redo, single-step undo, the `already` move and revert, over empty, absent (module), V1, V2 and Lua lists, with and without injected outside appends. After every step: a step built now changes the mode only when it is a switch or a `list` restore; every listed trigger item carries the span of its ops; and without an outside change, no T4 refusal occurs. | D | — (it checks the advisor's traced-by-reasoning claim that T4 refuses no legitimate route; a found refusal returns to this spec) | a seeded generator over the #708 service |
| TS16 | Row 0: no event builder writes index 0 in V2 mode, and a rename leaves row 0's `v2RunTrigger` targets alone (classic's loop starts at 1); only the mode switch and the restore of a `list` item touch row 0 | R | SC-2b base stub | V2 template; a crafted card whose row 0 holds a `v2RunTrigger` |
| TS17 | Low-level reading by 3.6: module `1` reads on and absent off; character `true`, `1`, `"true"` and `"false"` read on, `false` and absent off. The picker offers Low Level types exactly when on. The status button selects the advanced kind and writes nothing. | R | SC-3 merged (picker half: SC-5 merged) | crafted card through the decoder; S5 foreign fixture |
| TS18 | E-a: one bad row (`"x"`, or a plain object without `effect`) is inert while the others stay editable. The switch is refused for `"x"` and offered for the row without `effect` (R3-4). E-a′: a list that is not an array refuses every trigger plan, the switch and both restore kinds included (T1); a bad row 0 makes the list inert as a whole. The bytes are unchanged after edits in other kinds and other rows. | R | S7-0 merged | classic import; crafted card through the decoder for the row without `effect` |
| TS19 | Import (MC-4111). The flag on asks, Cancel writes nothing, and confirm is one step with n inserts; the flag off does not ask; a character flag of `1` asks. **Interleaves:** the flag turns on while the picker is open → it asks; the owner is deleted while the picker or the confirm is open → nothing written; **the list switches to Lua, or is emptied, while the picker or the confirm is open → nothing written, `studioScriptsChangedElsewhere`.** A malformed file imports nothing. | R | S7-0 merged | classic export file; crafted card |
| TS20 | Replay into a flag-on owner (MC-4112): undo of an event delete lands without a question | C | passes before (vacuously) and after | module replace-imported with the flag on |
| TS21 | Classic untouched: the existing `TriggerList.typeSwitch`, `TriggerList.luaHelp`, `TriggerV2List.*` and `TriggerV1Data.valueNames` tests pass, and the PR's diff names no classic trigger file | C | passes before and after | existing |
| TS22 | `.bin` round trip of Studio-edited triggers, 배경 HTML and CharacterJS | C | passes before and after | existing harness |
| TS23 | Restore line: Lua edits show "Scripts: undo 1 change", and the line restores the visit-start bytes; 500 Lua writes more than `COALESCE_MS` apart leave one journal entry; an outside change refuses only the scripts line | R | S7-0 merged | 25,000-character Lua |
| TS24 | Mixed revert: a range with a `trigger/` merge text edit and a trigger obj step is refused with `studioScriptRevertMixed` | R | S7-0 merged | merge on a V2 effect value |
| TS25 | Display safety (jsdom). A card's event name, effect values, an unknown effect type and a `triggerlua` effect's code hold `<img src=x onerror=…>`, `<script>` and `"><svg onload=…>`, and its `indent` is `"1;background:url(x)"`. The lists render no element from them and no style beyond a number. Lua, legacy code and CharacterJS show such text as text. 배경 HTML previews none of them. An identity sanitizer makes the 배경 HTML half fail (MC-239). | R | SC-1 (the 배경 HTML half), SC-4 (the lists) | crafted card through the import decoder |
| TS26 | No execution: mounting, editing, previewing and saving never call `runTrigger`, `runScripted` or the Lua engine factory (spies) | C | passes before and after | all modes |
| TS27 | Popup code editor: opens with language `lua` and the code. A changed close commits with the open-time `before`, merging into Lua typing within `COALESCE_MS`. An unchanged close commits nothing. **Row 0 changed while open** → refused with `studioScriptsChangedElsewhere`, nothing written. | R | S7-0 merged | Lua template |
| TS28 | Data-part census (66; 65 after SC-12) and `areaParts` | C | after the allow-list holds them | — |
| TS29 | `localeParity` in every PR that adds keys | C | — | — |
| TS30 | Gone owner: with an open sheet, the sheet closes and the draft is dropped; with the popup open, its later close writes nothing; with a mode confirm open, nothing is written | R | SC-5 merged (popup and confirm halves: SC-3 merged) | module, character |
| TS31 | Older builds set the #708 shapes aside whole, `span` included; the version stays 2 | D | scratch checkout | records written by the #708 service |
| TS32 | Size measurement: 50 Lua edits of a 300 KB script more than `COALESCE_MS` apart; 50 effect Saves in one event holding 200 KB of effects; a mode switch of a 2 MB list; a whole restore of it; a 100-event delete. Record the bytes, the deleted-item sizes, and which steps of **other kinds** the keep walk evicts (K1, S6 K10). | D | — | generated |
| TS33 | **Per category** (SC-5 to SC-10; one file per stage, one row per type):<br>(a) picking the type and saving inserts `v2DefaultEffect(type)` as TS11's append and insert-above rules place it;<br>(b) each spec field edits exactly its key; Save is one step, and undo restores;<br>(c) an existing effect with an unknown key keeps it through an edit;<br>(d) the spec's fields cover every key of the default except `type`, `indent` and `endOfLoop`, with one named exception: `v2GetLorebookCount`'s `outputVar`, which classic never shows;<br>(e) the type is offered or hidden in the picker by `checkSupported` for each trigger type and flag reading;<br>(f) an existing effect of the type stays editable when `checkSupported` rejects it (a Low Level effect with the flag off, a Special effect in a `manual` event) | R | Previous stage merged: the type has no spec, so (a) to (d) and (f) fail on assertions (the pending marker shows). (e) is C for types classic always offers. | `v2DefaultEffect`; `createBlankChar` |
| TS34 | V1 (SC-11): row add, delete (no ask, undo), move, comment and type. A condition add uses classic's add template, and an effect add depends on the row type. A type change of each condition type and of each of the 15 effect shapes writes classic's type-change template and drops the old keys. Edits go through the specs. Warnings follow classic's conditions and the 3.6 reading. | R | SC-10 merged: no V1 editor | templates pinned by TS10 |
| TS35 | Parity audit (SC-12): every pickable V2 type and every V1 effect and condition type has a spec; no scripts or 배경 HTML kind renders the classic link; the pending-marker key is gone | R | SC-11 merged: the link still renders | all kinds |
| TS36 | `triggercode` list (legacy view). The code shows as read-only text with `studioScriptsLegacyCode`. With extra effects in row 0 and extra rows, the shared extra notes show and say they still run (R3-3). No chip is pressed; Lua and V2 each switch with the ask, and V1 does while its chip shows (`showDeprecatedTriggerV1`); nothing edits the code. | R | SC-2b merged: no form | synthetic (no producer writes `triggercode` today; the row says so) |
| TS37 | **What runs is labelled, derived from the two predicates (jsdom).**<br>(a) **Predicates.** `hasEngineCase` holds exactly for the members of `triggerEffectV2['type']` and `triggerEffectV1['type']` and for `triggerlua`: a type-level exhaustiveness check under `pnpm check`, plus a run over `KNOWN_V2_TYPES` (101 distinct) and `V1_EFFECT_TYPES` (15). It is false for `triggercode`, `''` and made-up types. `runsOnEveryTrigger` holds exactly for rows whose first effect is `triggerlua` or `triggercode`.<br>(b) **Product.** View (V2 event and effect lists, V1 row, Lua view, legacy view) × the first effect of each shown row (`triggerlua`, `triggercode`, a V2 type, a V1 type, a made-up type, none; for the Lua and legacy views, row 0's other effects and the other rows) × extra rows or effects (none, some). In every cell: the every-trigger marker shows exactly when `runsOnEveryTrigger` holds, and its text does not say Lua; each effect row says it runs exactly when `hasEngineCase` holds; the Lua and legacy views show the extra notes exactly when extras exist, saying they still run. Cells a view cannot hold are skipped by name. For the V2 view, row 0 with and without effects after its `v2Header`: the header note shows exactly when it has them, with their count and row 0's Trigger On label (R4-2). | R | (a): "SC-2a with stub predicates returning false". (b) (R3-E4): SC-2b merged for the Lua and legacy views; SC-3 merged for the V2 view; SC-10 merged for the V1 view. | classic import of a mixed file; crafted card through the decoder for `triggercode` rows |
| TS38 | **T3 for builders (D16).** (a) The helper: mode and, in V2, row 0's anchor kept → pass; either changed → fail; a plan starting from another mode than offered → fail; `empty` counts as V1. (b) V1 builders on a list that already mixes kinds: delete or move row 0 when row 1 starts with `triggerlua`, `triggercode` or `v2Header`; move such a row to index 0; delete or move row 0's effects so that one of those types comes first. Each is refused with `studioScriptsModeWouldChange` and writes nothing. Ordinary V1 edits of row 0 (comment, type, conditions, a V1 effect add or type change), Lua typing, event builders and the import pass. | R | (a): "SC-0 with a helper stub that always passes". (b): stage-internal "SC-2b's builders without the helper call": each flipping plan lands. | crafted card through the decoder (mixed V1 lists) |

### 9.1 Mutants to kill

| Mutant | Rule it breaks | Test that must fail |
|---|---|---|
| MS1 `backgroundHTML` not in `TEXT_FIELD_PATHS` | router | TS2 |
| MS2 `writeHeld` ignores `had: 'foreign'` | exact undo (MC-4030) | TS3 |
| MS3 a sheet draft aliases the live effect object | I-S1 | TS13 |
| MS4 an effect edit rebuilds the effect from the spec fields | unknown keys kept | TS33 (c) |
| MS5 deleting a block opener removes its children | classic unwrap | TS11 |
| MS6 inserting an opener without its `v2EndIndent` | block integrity | TS11, TS33 (a) |
| MS7 `addElse` ignored on insert, or the Else toggle ignored on edit | classic Else rules | TS11 |
| MS8 a move ignores `canMoveEffect` | block rules | TS11 |
| MS9 paste does not rebase indents | classic paste | TS11 |
| MS10 an event builder writes index 0 | header row | TS16 |
| MS11 event delete allows removing the last event | classic limit | TS12 |
| MS12 rename skips the `v2RunTrigger` cascade | classic rename | TS12 |
| MS13 event delete untagged (no deleted item) | DD-100 restore | TS12 |
| MS14 a move is tagged as a delete | deleted items only for deletes | TS12 |
| MS15 Low Level types offered with the flag reading off | engine reading | TS17 |
| MS15b the flag read through the registry reader or `engineOn` (a character `1` reads off) | engine reading (F1) | TS17, TS19 |
| MS16 the status line writes the flag | single editor | TS17 |
| MS17 the Lua edit drops other effects or rows | keep extras | TS9 |
| MS18 the mode switch does not tag its removes | restorable old list | TS15 |
| MS19 the mode switch asks on an empty list, or never asks | D3 | TS15 |
| MS20 import ignores the flag | MC-4111 | TS19 |
| MS21 import partly accepts a malformed file | classic acceptance | TS19 |
| MS22 the parser accepts trigger ops on a chat record | R3 | TS7 |
| MS23 the trigger anchor excludes a key | per-list anchor | TS7 |
| MS24 the restore line shares lore's journal | per-list lines | TS23 |
| MS25 mixed revert ignores `trigger/` | R5 | TS24 |
| MS26 an effect summary rendered with `{@html}` | display safety | TS25 |
| MS27 `indent` placed in a style without `safeIndent` | display safety | TS25 |
| MS28 the 배경 HTML preview skips `strictPreviewHtml` | display safety | TS25 |
| MS29 the module write mutates the live slot | copy-on-write | TS14 |
| MS30 CharacterJS writes `showUnrecommended`, tests a non-empty string instead of truthiness, or drops the latch | classic gate, D12 | TS6 |
| MS31 closing the popup commits unchanged text | no empty step | TS27 |
| MS32 E-a offers menus on unreadable rows, or makes the whole list inert for one bad row | E-a, E-a′ | TS18 |
| MS33 a category spec drops one field of the classic form | per-type parity | TS33 (d) |
| MS34 the picker ignores the `display`/`request` allow lists | classic `checkSupported` | TS33 (e) |
| MS35 V1 delete asks | DD-100 | TS34 |
| MS36 the classic link still renders on a scripts kind | MC-4110 | TS35 |
| MS37 `replace` parses as `import` | honest stored label | TS7, TS15 |
| MS38 the mode switch skips the confirm-time fingerprint check | classic `isWarnedList` (F3) | TS15 |
| MS39 the import decides the ask before the file is parsed | MC-4111 timing (F3) | TS19 |
| MS40 the popup close plans against the live list without the open-time `before` | no silent overwrite (F3) | TS27 |
| MS41 Restore from History ignores the mode rule | MC-4114 | TS15b (3) |
| MS42 `v2EndIndent` rows offer no Insert above / Paste above | classic first child (F5) | TS11, TS12 |
| MS43 a `checkSupported`-rejected effect is not editable | classic edit (F5) | TS33 (f) |
| MS44 a V1 type change keeps the old keys | classic type change (F5) | TS34 |
| MS45 Move down of a block opener targets `start + 2` | menu move mapping (F5) | TS11 |
| MS46 the Delete key deletes events | classic safety (F7) | TS12 |
| MS47 the V1 chip is hidden on an empty list | classic `v1Enabled` (F5) | TS15 |
| MS48 paste or import copies through canonical JSON (keys sorted) | key order kept (F7) | TS12 |
| MS49 insert above uses `getInsertIndent` instead of the target's indent | classic insert (F4) | TS11 |
| MS50 a `triggercode` list is shown as editable Lua | legacy view (F7) | TS36 |
| MS51 inversion drops `span` (the re-listed item has no span, or the inverse ops are refused) | span provenance (T2) | TS15b (6), (7), (13) |
| MS52 the inverse replace's removes carry the live mode's span instead of `list` | E restorable (T2) | TS15b (5) |
| MS53 restore acceptance reads row content (draft 4's classes) instead of the recorded span | R3-1 | TS15b (9), (10); TS15c |
| MS54 the mode switch or the `list` restore gates on editor-readable instead of seam-holdable, or emits an op for a non-object row | R3-4, S7 R1 | TS15, TS15b (11), TS18 |
| MS55 the import skips the row-0 recheck | mode precondition (N4, T3) | TS19 |
| MS56 a `triggerlua` or V1 effect in a V2 list shows `studioScriptsUnknownEffect` | what runs is labelled (N5) | TS37 (b) |
| MS57 the extra-row note omits "still run" | what runs is labelled (N5) | TS36, TS37 (b) |
| MS58 the planner checks T4 at build time only, not on replay | T4 | TS15b (16), TS7 |
| MS59 a `restoreDeleted` step's redo lists no item (a label branch) | N10 | TS15b (13) |
| MS60 the `already` move on an inverse-replace step consumes D but lists no E | N10 | TS15b (14) |
| MS61 a `triggercode`-first row shows no every-trigger marker, or the legacy view hides the extra notes | R3-3 | TS36, TS37 (b) |
| MS62 the restore skips T3's after-check | T3 | TS15b (15) |
| MS63 a V1 builder skips the T3 helper | T3, D16 | TS38 (b) |
| MS64 the parser accepts a tagged trigger op without `span`, or a `v2` run naming index 0 | span rules | TS7 |
| MS65 `hasEngineCase` includes `triggercode`, or misses `triggerlua` | engine mirror | TS37 (a) |
| MS66 the T3 helper checks the mode only, not row 0's anchor in V2 | T3 | TS38 (a) |
| MS67 the planner refuses a mode change that holds no `list` run (draft 5's T4 mode clause) | T4 is run emptiness only (R4-1) | TS15 (empty list), TS7 |
| MS68 the V2 view hides row 0's effects after its `v2Header` | what runs is shown (R4-2) | TS37 (b) |
| MS69 the undo of the step that created an absent module list leaves `trigger: []` | exact undo (N3) | TS14, TS15 (empty list) |
| MS70 `studioScriptDeletedList` gets the raw `scriptModeOf` value, or a `triggercode` list item shows the Lua label | R4-E5 | TS15b (12) |
| MS71 a `created` remove deletes the `trigger` property although rows remain | delete only when the list is empty (N3, §4.5) | TS14 (outside append) |

## 10. Build stages

**History-core files:** `fieldRegistry.ts`, `historyModel.ts`, `ownerHistory.svelte.ts`, `studioSetters.ts`, `studioHistoryService.svelte.ts`, `studioStoreProtocol.ts`, and the S7 seam files `objectListOps.ts` and `objectLists.ts`. This is a superset of lane A's list (`Agents/Live-State.md:21` names the first three); every one of them takes the lock for this ticket.
- **A ★ stage edits at least one of them and runs alone.** No stage of any ticket that edits a history-core file runs at the same time, S7-0, S6a/b/e, S7-1, S2 and S8 included. Lane A's rule holds the lock until the ★ edit **merges**, so each ★ stage ships in its own short PR.
- #681's S3a, S3b and S3c are history-core builds queued behind S7-0, so they take the same lock and never run beside SC-1 or SC-0. S3a also appends to `TEXT_FIELD_PATHS` and amends `historyModel.s1TextFields.test.ts`, the literal pin SC-1 amends. #709's build is not history-core (lane A records check, 2026-11-24).
- Every stage after SC-0 reuses the S7 object-list ops through the trigger row and edits no history-core file. A stage that finds it must edit one stops and returns to the orchestrator; it then becomes ★.
- One fresh coder per stage, serial, in one worktree.
- Sizes are ESTIMATES and include tests.

| Stage | Content | Expected files | ★ | Coder | Gate 2 | Tests / mutants | Keys / parts |
|---|---|---|---|---|---|---|---|
| **SC-1** registry rows and 배경 HTML | `backgroundHTML` and `virtualscript` rows; `TEXT_FIELD_PATHS` and its three literal pins; `writeHeld` foreign branch; the 배경 HTML form and mount; link removed on that kind. 500-800 lines | `fieldRegistry.ts`, `historyModel.ts`, `studioSetters.ts`, the html form, `StudioDetail.svelte`, tests | ★ | Opus | opus-reviewer | TS1-TS5, TS25 (배경 HTML); MS1, MS2, MS28 | 1 key; 2 parts |
| **SC-0** trigger list in the seam | `trigger` rows in every S7 table; N2-N11 where missing, including N3's recorded creation of an absent module list; `replace`; `span` on ops and items with its parser rules; the planner checks (T1, T4 as run emptiness, the `v2` index rule); `triggerRestoreRule` (inverse replace with a caller-supplied id for E, span acceptance, the seam-holdable refusal); in `scriptMode.ts`, the T3 helper `checkTriggerModeKept`, `liveSpanOf` and the seam-holdable and editor-readable predicates; restore, presentation (localised mode labels), refusal and label keys. 600-1,000 lines | `objectLists.ts`, possibly `objectListOps.ts`, `historyModel.ts`, `ownerHistory.svelte.ts`, `studioHistoryService.svelte.ts`, `studioSetters.ts`, `ts/studio/scriptMode.ts`, `en.ts` + 7 locales, tests | ★ | Opus | opus-reviewer | TS7, TS8, TS14 (the absent-list undo), TS15b, TS15c, TS15d, TS31, TS38 (a); MS22-MS25, MS37, MS41, MS51-MS53, MS54 (restore half), MS58-MS60, MS62, MS64, MS66, MS67, MS69, MS70, MS71 | 12 keys; 0 parts |
| **SC-2a** classic goldens and pure modules | The golden recorder (and the verbatim oracle where jsdom cannot drive classic); `triggerTemplates.ts`, `triggerV2Defaults.ts` (98 types plus `v2Else`), `triggerV2Blocks.ts`, matched to the goldens; `triggerKinds.ts` (`hasEngineCase`, `runsOnEveryTrigger`, `effectKindOf`) over the two type sets, which `referenceTargets.ts` exports. Classic is not changed. 900-1,250 lines, mostly corpus and goldens | `ts/studio/edit/triggerTemplates.ts`, `ts/studio/edit/triggerV2Defaults.ts`, `ts/studio/edit/triggerV2Blocks.ts`, `ts/studio/edit/triggerKinds.ts`, `ts/studio/assets/referenceTargets.ts` (two `export` keywords only), `ts/studio/edit/tests/*` (goldens, recorder, oracle) | no | Opus (the oracle decides persisted list writes) | opus-reviewer | TS10, TS11, TS21, TS37 (a); MS5-MS9, MS42, MS45, MS49, MS65 | none |
| **SC-2b** step builders | `edit/triggerOps.ts`: Lua, popup close, the mode switch (non-empty: fingerprint, span `list`, the seam-holdable refusal; empty: untagged template inserts, planned only while still empty), import with its row-0 recheck, events (span `v2` on deletes; the rename from row 1), effect arrays, V1 rows (span `v1` on deletes); every builder other than the switch calls the T3 helper (D16). 550-800 lines | `ts/studio/edit/triggerOps.ts`, tests | no | Opus (persisted list writes) | opus-reviewer | TS9, TS14, TS16, TS15 (builder half, empty list included), TS15b and TS15c re-run through the builders, TS38 (b); MS10, MS17, MS18, MS29, MS54 (switch half), MS63 | none |
| **SC-3** form shell | `StudioScriptsForm.svelte`: chips (V1 on empty, seam-holdable refusal), mode sheet with recheck, the Lua view and the legacy view with the shared "still run" notes, popup button, Help, low-level status (3.6), CharacterJS with latch, import/export with the timing of 3.10, E-a views, states; the `StudioDetail` mounts; the `scriptModeOf` comment corrected. 800-1,100 lines | `lib/Studio/StudioScriptsForm.svelte`, `StudioDetail.svelte`, `ts/studio/scriptMode.ts` (comment only), `en.ts` + 7 locales, `areaParts.test.ts` (guard, exact grant), tests | no | Sonnet | opus-reviewer (security) | TS6, TS15, TS17 (status), TS18-TS20, TS22-TS24, TS26-TS30 (popup, confirm), TS36, TS37 (b: Lua and legacy views); MS15b, MS16, MS19-MS21, MS30-MS32, MS38-MS40, MS47, MS50, MS55, MS57, MS61 (legacy half) | 21 keys; 27 parts |
| **SC-4** V2 event and effect lists | Windowed event list, the header note for row 0's effects, row menus, the every-trigger marker, selection mode, keyboard (no Delete on events), rename (from row 1), Trigger On, clipboard; effect rows by `effectKindOf` with `effectSummaryParts`, effect menus per 3.4 (`v2Header`, `v2Else` and `v2EndIndent` rows included), the Move up / down mapping, pending rows. 950-1,400 lines | `StudioTriggerEvents.svelte`, `StudioTriggerEffects.svelte`, `triggerEffectDisplay.ts` (`effectSummaryParts` only), keys, tests | no (★ if obj focus routes through a core file, 4.3) | Sonnet | opus-reviewer (display safety, list writes) | TS12, TS25 (lists), TS37 (b: V2 view, row 0 included); MS11-MS14, MS26, MS27, MS46, MS48, MS56, MS61 (V2 half), MS68 | 20 keys; 19 parts |
| **SC-5** effect sheet framework + **Control** (12) | Sheet, picker (categories, `checkSupported`, D9), field-kind renderer, Else toggle, Save/Cancel, insert/edit; specs for `v2SetVar`, `v2DeclareLocalVar`, `v2Calculate`, `v2IfAdvanced`, `v2LoopNTimes`, `v2Loop`, `v2BreakLoop`, `v2Command`, `v2ConsoleLog`, `v2RunTrigger`, `v2StopTrigger`, `v2Comment`. 900-1,200 lines | `StudioTriggerEffectSheet.svelte`, `StudioTriggerField.svelte`, `ts/studio/edit/triggerV2Specs.ts`, keys, tests | no | Sonnet | opus-reviewer (block rules through the sheet) | TS13, TS17 (picker), TS30 (sheet), TS33 (Control); MS3, MS4, MS15, MS33, MS34, MS43 | 1 key; 10 parts |
| **SC-6** **Chat** (10) + **Alert** (3) | Specs for `v2CutChat`, `v2ModifyChat`, `v2Impersonate`, `v2GetLastMessage`, `v2GetLastUserMessage`, `v2GetLastCharMessage`, `v2GetMessageAtIndex`, `v2GetMessageCount`, `v2GetFirstMessage`, `v2QuickSearchChat`; `v2ShowAlert`, `v2GetAlertInput`, `v2GetAlertSelect`. 300-500 lines | `triggerV2Specs.ts`, tests | no | Sonnet | Sonnet reviewer | TS33; MS33, MS34 | none |
| **SC-7** **String** (10) + **Data** (8) | `v2RegexTest`, `v2ExtractRegex`, `v2GetCharAt`, `v2GetCharCount`, `v2ToLowerCase`, `v2ToUpperCase`, `v2SetCharAt`, `v2SplitString`, `v2ConcatString`, `v2ReplaceString`; `v2GetCharacterDesc`, `v2SetCharacterDesc`, `v2GetPersonaDesc`, `v2SetPersonaDesc`, `v2GetReplaceGlobalNote`, `v2SetReplaceGlobalNote`, `v2GetAuthorNote`, `v2SetAuthorNote`. 350-550 lines | same | no | Sonnet | Sonnet reviewer | TS33 | none |
| **SC-8** **Array** (13) + **Dictionary** (9) | `v2MakeArrayVar`, `v2GetArrayVarLength`, `v2GetArrayVar`, `v2SetArrayVar`, `v2PushArrayVar`, `v2PopArrayVar`, `v2ShiftArrayVar`, `v2UnshiftArrayVar`, `v2SpliceArrayVar`, `v2SliceArrayVar`, `v2GetIndexOfValueInArrayVar`, `v2RemoveIndexFromArrayVar`, `v2JoinArrayVar`; `v2MakeDictVar`, `v2GetDictVar`, `v2SetDictVar`, `v2DeleteDictKey`, `v2HasDictKey`, `v2ClearDict`, `v2GetDictSize`, `v2GetDictKeys`, `v2GetDictValues`. 400-600 lines | same | no | Sonnet | Sonnet reviewer | TS33 | none |
| **SC-9** **Lorebook V2** (8) + **Others** (7) | `v2GetAllLorebooks`, `v2GetLorebookByName`, `v2GetLorebookByIndex`, `v2CreateLorebook`, `v2ModifyLorebookByIndex`, `v2DeleteLorebookByIndex`, `v2GetLorebookCountNew`, `v2SetLorebookAlwaysActive`; `v2Random`, `v2UpdateGUI`, `v2SystemPrompt`, `v2UpdateChatAt`, `v2Wait`, `v2StopPromptSending`, `v2Tokenize`. 350-550 lines | same | no | Sonnet | Sonnet reviewer | TS33 | none |
| **SC-10** **Special** (7) + **Low Level** (4) + **Deprecated** (7) | `v2GetDisplayState`, `v2SetDisplayState`, `v2GetRequestState`, `v2SetRequestState`, `v2GetRequestStateRole`, `v2SetRequestStateRole`, `v2GetRequestStateLength` (display/request allow lists); `v2SendAIprompt`, `v2ImgGen`, `v2CheckSimilarity`, `v2RunLLM` (gated by the flag reading); `v2If`, `v2ModifyLorebook`, `v2GetLorebook`, `v2GetLorebookCount` (the TS33 (d) exception), `v2GetLorebookEntry`, `v2SetLorebookActivation`, `v2GetLorebookIndexViaName`. 450-650 lines | same | no | Sonnet | opus-reviewer (Low Level gating is a security input) | TS17, TS33; MS15, MS15b, MS34, MS43 | none |
| **SC-11** V1 editor | Rows, conditions (four types), effects (15 shapes) and other-kind rows by `effectKindOf`, the every-trigger marker, add and type-change templates, warnings, delete without ask, move, the T3 refusal notice (D16); `V1_*_SPECS`. 900-1,300 lines | `StudioTriggerV1.svelte`, `ts/studio/edit/triggerV1Specs.ts`, keys, tests | no | Sonnet | opus-reviewer (list writes, low-level warnings) | TS34, TS37 (b: V1 view); MS35, MS44, MS61 (V1 half) | 0 keys; 8 parts |
| **SC-12** link removal and audit | Classic link removed on the scripts kinds; `studioScriptsEffectPending` and its part removed (8 locales); parity audit; a Note 9 check of the phone layout (synthetic data, MC-1666) | `StudioDetail.svelte`, `en.ts` + 7 locales, tests | no | Sonnet | Sonnet reviewer | TS28, TS35; MS36 | −1 key; −1 part |

**Order:**
1. SC-1 can start now (no seam). It is ★ and waits for any other ★ edit, S7-0's included, to merge.
2. S7-0 merges; then SC-0 (★, alone).
3. SC-2a, then SC-2b, then SC-3, then SC-4, then SC-5.
4. SC-6 to SC-10, in any order among them. Each only appends rows to `triggerV2Specs.ts`, so they serialize on that one file.
5. SC-11, at any time after SC-5.
6. SC-12 last.

S6a/b, S7-1, #681's S3a and #709's L2 also touch `StudioDetail.svelte`, so they serialize with SC-1, SC-3 and SC-12.

**Suggested PRs.** Each carries its locales (MC-058) and gets one Gate 2 at the strongest reviewer any of its stages needs. ★ stages ship alone, so the history-core lock is held only for a short PR.

| PR | Stages | What works after it |
|---|---|---|
| PR-A | SC-1 (★) | 배경 HTML form |
| PR-B | SC-0 (★) | the trigger list in the seam, with the span, T1 to T4 and the restore rule; no UI |
| PR-C | SC-2a + SC-2b + SC-3 | Lua, mode switch, import/export, CharacterJS and the legacy view work end to end; V2 and V1 bodies show pending rows |
| PR-D | SC-4 + SC-5 | V2 lists with every effect kind labelled, effect sheet, Control category |
| PR-E | SC-6 to SC-10 | the remaining V2 categories |
| PR-F | SC-11 + SC-12 | V1 editor; classic link removed |

**Totals (ESTIMATE):** about 30-40 application files changed or added, plus 8 locale files in each PR that adds keys; about 7,900-11,000 lines, including tests and goldens. No classic trigger file changes.

## 11. Risks, known limits and failure scenarios

**Changed critical contracts.** opus-reviewer runs at the Gate 2 of each stage that changes one.

| # | Contract | Stages |
|---|---|---|
| 1 | The persisted character record (two registry writes, foreign undo) | SC-1 |
| 2 | The persisted trigger lists of characters and modules (upstream shape, unknown keys, block integrity, classic-equal values) | SC-2a to SC-5, SC-11 |
| 3 | The Studio history stored record (trigger rows, array kind, `replace`, `span`, the planner checks T1 and T4, the restore rule, two paths) | SC-0, SC-1 |
| 4 | Dirty tracking (I-S1) | SC-2b to SC-5 |
| 5 | The text router (`backgroundHTML`) | SC-1 |
| 6 | Security inputs: the low-level reading (3.6); the import timing and mode recheck; text-only display; what runs is labelled | SC-0, SC-3, SC-4, SC-10, SC-11 |

| # | Failure scenario | Guard | Test |
|---|---|---|---|
| F1 | An editor writes saved data without a step or mark | I-S1 | TS13 |
| F2 | A Save, a popup close, a mode switch or an import overwrites or mixes with an outside change | anchors; open-time `before`; confirm-time fingerprint; row-0 recheck | TS13, TS15, TS19, TS23, TS27 |
| F3 | An edit drops an unknown key, an extra effect or an extra row | specs edit keys of the existing object; Lua builder | TS9, TS33 (c), TS22 |
| F4 | A block is left without its `v2EndIndent`, or a delete removes children | block functions pinned to classic goldens | TS11 |
| F5 | The header row moves or goes outside the mode switch or a `list` restore | builder rule; T3; a `v2` run never names index 0 | TS15b (9), TS16, TS38 |
| F6 | A move lists a deleted item, or a delete lists none | builders | TS12, TS15 |
| F7 | An older build misreads a trigger record | R8, version 2 | TS7, TS31 |
| F8 | A merge on 배경 HTML is invisible to restore | router | TS2 |
| F9 | Undo cannot put back a foreign 배경 HTML or CharacterJS value | writer branch | TS3, TS6 |
| F10 | Card text becomes markup or style in Studio | text segments, `safeIndent`, strict preview | TS25 |
| F11 | Script content executes from Studio | no run path | TS26 |
| F12 | Imported code gains low-level access without a question (a character flag of `1`; a flag turned on while the picker was open) | MC-4111 with the 3.6 reading, decided after parsing | TS17, TS19 |
| F13 | Low Level effects offered with the flag reading off, or hidden while the engine reads it on | the 3.6 reading | TS17, TS33 (e) |
| F14 | A type's form misses a field classic edits | spec coverage | TS33 (d) |
| F15 | Large Lua typing keeps one copy per keystroke | S7 tail-merge | TS23 |
| F16 | A revert mixes trigger obj ops with a merge's trigger text edit | R5 | TS24 |
| F17 | A module write mutates the live slot | copy-on-write | TS14 |
| F18 | A restore, or a replay without an outside write, mixes modes; or a switched-away or replaced list becomes unrecoverable while it is listed | span; `triggerRestoreRule`; T3; T4; N10 | TS15b, TS15c, TS15d |
| F19 | Studio's block rules drift from classic's | classic goldens over a malformed corpus | TS10, TS11 |
| F20 | Code that runs is shown as unknown, inert or hidden behind a count | `hasEngineCase`, `runsOnEveryTrigger`; the shared extra notes | TS36, TS37 |
| F21 | A step names or skips a row the seam cannot hold | seam-holdable refusal | TS15, TS15b (11), TS18 |
| F22 | A builder or a restore silently changes a list's mode (for example, row 0 of a mixed V1 list deleted) | T3 helper (D16) | TS15b (15), TS38 |
| F23 | An empty-list switch cannot be committed, undone or redone, or its undo leaves `trigger: []` where the module had none | T4 limited to run emptiness; N3 records the creation | TS14, TS15 |
| F24 | Code in row 0 of a V2 list runs unshown | the header note | TS37 (b) |
| F25 | The undo, revert or restore line of a step that created a module's list deletes `trigger` while an outside-made row remains | the `created` remove deletes the property only when it leaves the list empty | TS14 (outside append), MS71 |

**Known limits:**
- **K1 Size.**
  - A coalesced Lua step, an effect Save in a large event, a mode switch and a large delete each store about the list or array they touch. A whole restore stores both lists.
  - A step over the 2 MiB owner share is never stored. The keep walk then drops older steps, **of every kind, not only scripts** (#716, MC-4052); a few 300 KB Lua steps can push out the owner's other history.
  - Session undo still works.
  - TS32 measures this. A cap or a finer op returns as a question only if needed (MC-3998 precedent).
- **K2 Replay after a replace-import (MC-4112).** A module replace-imported with the flag on keeps its id and history. Undoing an older step can re-insert an older trigger that now runs with Low Level Access, without a question.
- **K3 Interim pending rows.** Between SC-4 and SC-10, effects of a category not yet built show as pending: they can be moved and deleted, not edited. The classic link stays on the scripts kinds until SC-12. This exists only on `main`, before the fork's first release (MC-089).
- **K4 Asset-merge steps** address trigger text by index. After a move, an old merge step's undo can meet another row (S6 K1). A revert mixing them is refused.
- **K5 Twin triggers** follow S7's `content` count rule (S6 K13).
- **K6 Classic and Studio editing at once.** There is no lock. Anchors protect Studio's own writes, not classic's live writes. After an outside write, a replay can mix kinds without T3 or T4 applying, because the mode is unchanged or the step holds no `list` run:
  - a row step replayed after a classic mode switch can put a V2 event into a Lua list (Gate 1 round 4, closure attack);
  - the undo of an empty-list switch after an outside append leaves the appended row behind.

  The list is then shown row by row with what runs.
- **K7 `showDeprecatedTriggerV2`** has no editor outside classic's picker. When classic retires, it needs a home in Settings or its own retirement (section 15).
- **K8 (removed in draft 5).** Draft 4 accepted that a redo of a mode switch after an outside append left a mixed list. T4 now refuses that replay as changed elsewhere, header Undo stops there, a single-step undo of that step is refused the same way, and the list stays as it is.
- **K9 Popup text on refusal.** A popup close refused as changed elsewhere drops the typed text (D2). The user reopens the popup on the current code.
- **K10 Eviction (R3-E3).** History lists at most `MAX_DELETED` (50) deleted items (S7 §4.4).
  - A `list` item D evicted past 50 makes Undo of its switch take `dropStep` (S7 §4.4 known limitation), and the old list is then gone.
  - Each whole restore lists one more item E, so a long chain of restores evicts older items sooner.
  - "Recoverable" in this spec therefore means "while the item stays listed".
- **K12 Absent module list (only if the merged seam cannot carry the `created` op key, N3).** The undo of the step that created a module's `trigger` leaves `trigger: []`. Studio reads both as `empty` (`scriptMode.ts`), but the bytes differ.

## 12. Product decisions (answered 2026-11-24)

| Q | Question | Answer | MC | Where it lands |
|---|---|---|---|---|
| Q1 | How does Studio edit V2 and V1 triggers? | **B:** native Studio V2 and V1 editors for all 101 effect types; no hosted classic component; no classic link remains | MC-4110 | §1, §1.2, §3.2-3.7, §7, §10 (SC-2a to SC-12), TS10-TS13, TS33-TS37 |
| Q2 | Does importing triggers ask while Low Level Access is on? | **B:** ask when the flag reads on and rows are added | MC-4111 | §3.10, §5, TS19, MS20, MS39, MS55 |
| Q3 | Do replays that bring trigger code back into a flag-on owner ask? | **A:** no; only the flag's own turn-on asks (MC-3984) | MC-4112 | §4.3, §5, K2, TS20 |
| Q4 | Does Studio edit CharacterJS? | **A:** editable text behind classic's gate, with a "never runs" note | MC-4113 | §3.9, §4.2, TS6, MS30 |
| Q5 | What does Restore from History do with a deleted trigger item whose mode differs from the live list's? | **B+A:** a mode switch's whole-list item restores as an inverse replace; any other cross-mode item is refused with a message | MC-4114 | §4.1, §4.3 (span, T1 to T4, the restore rule), §4.5, N9 to N11, SC-0, TS15b, TS15c, MS41, MS51-MS54, MS58-MS60, MS62, F18 |

MC-4114's consequence names "a `whole` item flag" and says "a restore never produces a mixed list".
- Draft 5 records the flag as span `list` on the ops, under a wider key that also records a row item's source mode (4.3). T3 and T4 make "never mixed" an invariant instead of a list of cases. The answer itself is unchanged; the session may record this as a derived note in its own `Agents/mc/708.md`. "Always recoverable" means recoverable while the item stays listed (K10).
- Two observable differences from draft 4, both inside MC-4114's wording:
  - an effect-less V1 row deleted before a switch to V2 is now refused, because it is a cross-mode item;
  - same-list restores of rows of any content are now accepted.

## 13. Design defaults (Gate 1 may veto)

- **D2** "Changed elsewhere" refuses the Save, the popup close, the mode switch or the import, drops the draft, and shows a notice (MC-3896 analog).
- **D3** The mode switch asks once on a non-empty list (MC-4009 analog), rechecks the list at confirm, is one undoable step, and lists the old list as one `list` item.
- **D4** Lua gets an "Open in code editor" button. The app-wide hotkey and long press stay app settings (MC-4043).
- **D5** The clipboard lives in memory only and is scoped to the owner and mode; paste never asks.
- **D6** The 배경 HTML form follows S5's html section and reuses `studioModAdvValueForeign`.
- **D7** The event list and the event detail sit side by side from 1280.
- **D8** Reorder by row menu and Alt+↑/↓, which reach every position a drag reaches; drag-and-drop is a follow-up ticket (the MC-4080 precedent for lore). Vetoing D8 adds a drag stage after SC-4.
- **D9** The picker always lists Deprecated last, collapsed, and marked with `sidebarUi.deprecatedTag`. Studio never writes `showDeprecatedTriggerV2`. Existing deprecated effects are always editable.
- **D10** Keyboard as classic: on effects, arrows, Alt+↑/↓ (Move up / down), Ctrl+C / Ctrl+V and Delete; on events, the same **without Delete**. Ctrl+Z stays Studio's history key.
- **D12** CharacterJS latches once shown (the `StudioAdvancedForm` precedent).
- **D13** A `triggercode` list shows as read-only legacy code. Classic showed it in the V1 editor, where it was neither readable nor useful; this build never runs it.
- **D14** E-a′: a list that is not an array refuses every trigger plan (T1). A list whose row 0 is not editor-readable is inert as a whole in the editors, because the mode comes from row 0. Its mode switch stays offered while every row is seam-holdable, so it can be replaced and its old content kept as a History item. Any other row that is not editor-readable is inert alone. Only a row that is not seam-holdable blocks the mode switch and a `list` restore (R3-4).
- **D15** A whole restore into a list of the same mode is still an inverse replace. It is not merged into the live list, and the replaced rows become item E.
- **D16** T3 applies to editor builders as well as to Restore from History: a V1 edit that would change the list's mode is refused with `studioScriptsModeWouldChange` (3.7). Classic lets such an edit flip the mode silently; only lists that already mix kinds reach it. If Gate 1 vetoes D16:
  - T3 applies to the restore rule only;
  - the builder case becomes known limit K11, "a V1 edit of a mixed list can change its mode, as in classic";
  - TS38 (b) and MS63 are dropped, and the key stays for the restore.

D1 (draft 1) is gone with Q1 B, and D11 (draft 2) is withdrawn (4.1).

## 14. Premises

| Premise | Status |
|---|---|
| Trigger, condition and effect shapes; six trigger types; 101 V2 type declarations | REOPENED (`triggers.ts:26-80`; regex count); Gate 1 confirmed |
| The 12 categories and their 98 types, by name; the Deprecated gate | REOPENED (`TriggerV2List.svelte:25-148, 459-477`) |
| Defaults (99 case labels, all at indent 0) and per-type forms | REOPENED (`:584-1528`; a grep of non-zero `indent:` literals finds only the save handler). The form counts and the `v2GetLorebookCount` gap come from Gate 1's executed check (INHERITED). Each category stage reads its own forms. |
| Save, insert, edit, delete, copy, paste, move and Alt rules | REOPENED line by line (`:1530-1667, 1831-2000, 2065-2109, 2183-2188, 2303-2362, 2745-2760, 3976-4079`) |
| Event list operations, paste position, Delete-key ban, rename cascade, Trigger On, import, export | REOPENED (`:505-542, 1669-1724, 2119-2160, 2552-2629`) |
| One engine switch for V1, Lua and V2 effects; no `default`; no `triggercode` case; Lua-first rows skip the Trigger On filter | REOPENED (`triggers.ts:1372-1385, 1498, 1730-1760`; Grep `default:` in `triggers.ts`, 0 matches; Grep `triggercode` in `src/ts` case-sensitive, `*.test.ts` excluded, 6 matches, COMPLETE (Gate 1 R5-E3)). `scriptMode.ts`'s comment is REFUTED for this build. |
| The engine type sets in Studio: `KNOWN_V2_TYPES` (101 entries, typed by the V2 union) and `V1_EFFECT_TYPES` (15) | REOPENED (`referenceTargets.ts:92-117`; entries COUNTED by hand; distinctness is asserted by TS37 (a)) |
| The filter bypass skips both the manual-name and the Trigger On filter for `triggerlua`- and `triggercode`-first rows | REOPENED (`triggers.ts:1372-1385`); Gate 1 round 3 read the same lines |
| `scriptModeOf` reads only `list[0]?.effect?.[0]?.type`, returns `empty` for a missing or zero-length list, and gives a non-array or an unreadable row 0 a mode | REOPENED (`scriptMode.ts:14-20`) |
| Today's greeting replay handles `restoreDeleted` by label: redo consumes the label's id and lists nothing; undo re-lists only that id (the hazard N10 names) | REOPENED (`historyModel.ts:2771-2793`) |
| The span, T1 to T4 and the closure table | design, from the senior-advisor's direction (708-adv1). T4 on the `already` witness and on revert is traced by reasoning, not executed; TS15d checks it. |
| A V2 row 0 is filtered like any row, and `case 'v2Header'` is a no-op, so row 0's other effects run when its Trigger On fires and its conditions hold. A bypass row's conditions are still evaluated. | REOPENED (`triggers.ts:1394-1397`, `:1756-1759`); Gate 1 round 4 read the same lines |
| Classic's rename cascade starts at row 1 | REOPENED (`TriggerV2List.svelte:2605`) |
| `checkSupported`; the escaped `{@html}` display and its raw-type fallback; `formatEffectLabel` | REOPENED (`triggerEffectDisplay.ts:1-166`) |
| V1 editor, add templates, type-change templates, 15 effect options | REOPENED (`TriggerV1Data.svelte:40-329`); `TriggerV1List.svelte` INHERITED from draft 1 |
| Classic modes, `v1Enabled`, `isWarnedList`, templates, Lua editor | REOPENED (`TriggerList.svelte:1-108`) |
| Popup editor: global store, hand-back on close, no `lua` preview | REOPENED (`PopupEditor.svelte:1-130`; `TextAreaInput.svelte:70-113`) |
| Engine flag reading is raw truthiness; card import keeps a raw flag; the registry reads `1` as absent | REOPENED (`triggers.ts:1113, 1606`; `characterCards.ts:791, 1747, 1824`; `fieldRegistry.ts:28, 132`; `studioSetters.ts:147-184`; `riskyFlags.ts:33-36`) |
| `toPlainJson` keeps key order and normalises non-JSON values | REOPENED (`normalize.ts:35-93`); CONFIRMED, closing draft 3's UNCERTAIN premise |
| Classic mounts and the truthy CharacterJS gate; `virtualscript` never run | REOPENED (`CharConfigPanel.svelte:836-847`; Grep) |
| Studio kinds, items, classic link | REOPENED in draft 2 |
| Registry, `writeHeld`, the module foreign branch, the router | REOPENED in draft 2; the `keepForeign` rule REOPENED (`fieldRegistry.ts:28`) |
| Focus placement lives in `historyFocus.ts` | REOPENED (`historyFocus.ts:133-160`) |
| The CharacterJS latch precedent | REOPENED (`StudioAdvancedForm.svelte:105-114`) |
| Reused locale keys exist | REOPENED for `edit`, `remove`, `add`, `always`, `noEffect`, `triggerEffectCategory`, `sidebarUi.unnamedTrigger`/`nSelected`/`conditions`/`effects`, `uiCommon.save`/`delete`/`undo` and the V1 labels listed (Grep of `src/lang/en.ts`); the rest INHERITED |
| Asset merge on trigger text; Lua flag only | REOPENED in draft 2 |
| Preview sanitizer and sandbox; store caps; history not in `.bin` | INHERITED from draft 2 |
| The S7 seam: ops, planner, tables, R1-R9, the tag rule, items complete from their ops, `already` listing, restore semantics, label shape and `ObjAction` | INHERITED from the S7 r6 text (§4-4.4 read in round 1; round 2's quotations of §4.2, §4.4 and §4.6 match it), not code. S7-0 was not merged on 2026-11-24, and in-progress S7-0 files are not cited. |
| S6 regex rows, K1, K10, K13, E5 | INHERITED from S6 draft 6 |
| S5 foreign rules, risky guard, html form, F8/G5 | INHERITED from S5 r4 and the built code |
| The card import decoder keeps crafted trigger strings and foreign `backgroundHTML` and `virtualscript` (fixture producers) | UNCERTAIN: the build names the decoder. The raw flag is REOPENED (`characterCards.ts:1824`). |
| Classic V2's phone panes are not reused, so Studio's layout (3.12) is new design | design, not a premise |
| MC-4110 to MC-4114 | REOPENED (`Agents/mc/708.md`, worktree copy) |
| The other MC entries named in the header | REOPENED in draft 2; Gate 1 confirmed the ones it cites |

## 15. Open items for the Orchestrator and lane A

- **File follow-up tickets:**
  - E-a, "Studio: repair unreadable trigger lists" (as #720 is for lore);
  - D8, "Studio: drag-and-drop reorder of triggers and effects" (as #718), unless Gate 1 vetoes D8.
- **E-c:** whether #714 covers trigger lists for a shared module id.
- **Cross-ticket (lane A):** S2's switch and risky guard read a character `lowLevelAccess` of `1` or `"true"` as off (the registry reader, without `keepForeign`), while the engine reads it as on. It over-asks and never under-asks, but S2's switch shows the wrong state. Not in #708's scope.
- **K7, classic retirement:** `showDeprecatedTriggerV2` needs a home in Settings or its own retirement when classic goes. So does `showDeprecatedTriggerV1`, which has no toggle anywhere in `src/lib`.
- **S7-0 recheck:** SC-0's Gate 1 plan checks N1 to N11 against the merged S7-0. This spec is revised if the seam's shape differs. N9 adds per-list columns and the `span` and `created` op keys, N10 a label-agnostic listing rule, and N11 a caller-supplied id. S7-0's author should see them before S7-0 merges, so the tables leave room for them.
- **Lock list:** this spec takes the history-core lock for `studioHistoryService.svelte.ts` and `studioStoreProtocol.ts` as well as Live-State's three files. Lane A decides whether Live-State's list grows.
- **Guard file:** `themePack/areaParts.test.ts` may need an exact grant (SC-3, SC-4, SC-5, SC-11).
- **Serialization:** SC-1 and SC-0 are ★, run alone across tickets and ship alone. SC-6 to SC-10 serialize on `triggerV2Specs.ts`.
- **Fallback (advisor):** if a later round rejects the inverse replace or whole items again, ask the maintainer whether Q5 falls back to option A (a switch is undoable, its old list is not a History item, every cross-mode item is refused). Under the span design, option A needs only `v1` / `v2`, T3 and one comparison. No sixth draft is written first.
- **Derived MC note:** span `list` is MC-4114's `whole` flag under a wider key (section 12). The session may record that in its own `Agents/mc/708.md`; the answer is unchanged.
- **D16 veto:** if Gate 1 vetoes builder-side T3, apply the D16 fallback; no maintainer question is needed.

## 16. Finding dispositions

### Gate 1 round 1 (all ACCEPTED by round 2, F2 in direction)

| Finding | Disposition | Where |
|---|---|---|
| F1 character flag read as off | ADDRESSED | §0, §3.6, §3.10, TS17, TS19, MS15b, §15 |
| F2 restore across a mode change | Answered as MC-4114 (B+A); implementation corrected by round 2 N1 to N3 | §4.3 |
| F3.1 / F3.2 / F3.3 ask-then-commit rechecks | ADDRESSED; F3.2 completed by N4 | §3.2, §3.10, TS15, TS19, TS27 |
| F4 oracle, insert indent, TS33 (d) | ADDRESSED (classic untouched, goldens) | §1.1, §2, §3.4, TS10, TS11, TS33 |
| F5.1 to F5.5 classic parity | ADDRESSED | §3.2, §3.4, §3.7, TS11, TS15, TS33, TS34 |
| F6 to F10 | ADDRESSED | §6, §8, §3.3, §4.1, §10, D12 |

### Gate 1 round 2

| Finding | Disposition | Where |
|---|---|---|
| N1 `whole` lost on re-listing; E never whole | **ADDRESSED** (option b): `whole: true` on the tagged ops of a mode switch, of the inverse replace's removes and of a whole restore's inserts; kept by inversion; items derive it; parser rules. Superseded in draft 5 by the span (round 3, below). | header, §3.2, §4.1, §4.3, §4.5, N9, TS7, TS15b (5)-(8), MS51, MS52 |
| N2 restore to index 0 ahead of `v2Header` | **ADDRESSED:** non-whole restores into a V2 list clamp to `1..length`. Superseded in draft 5: span acceptance keeps a `v1` item out of a V2 list, and a `v2` run never names index 0 (round 3, below). | §4.3, F5, TS15b (9), MS53 |
| N3 switch and inverse replace over a non-object row | **ADDRESSED:** both refused with `studioScriptsUnreadableBlocks` while any live row is not a plain object | §3.2, §4.3, §6, §7 E-a, D14, TS15, TS15b (11), MS54, F21 |
| N4 import without a mode recheck | **ADDRESSED:** row 0's anchor kept when the picker opens, rechecked after parsing and at confirm | §3.10, TS19, MS55 |
| N5 running code labelled unknown and inert | **ADDRESSED:** `effectKindOf` classes (`v2`, `lua`, `legacy`, `v1`, `unknown`) follow the engine switch; the Lua-row marker; the "still run" notes; the unknown text says it runs nothing; a new TS37 | §0, §3.2-3.4, §3.7, §5, §6 (4 new keys, 3 reworded), §8 (4 new parts), TS25, TS37, MS56, MS57, F20 |
| E1 stale Q5 and placement text; MC-4110 to MC-4114 | **ADDRESSED** | header, §10, §12, §15 |
| E2 "no Studio action can mix modes" | **ADDRESSED:** "no restore and no editor builder"; imports and K8 named | §4.3 |
| E3 the class of a multi-row item | **ADDRESSED** in draft 4 (every row must be accepted). **Superseded in draft 5 by the span:** content classes are gone, TS15b (10) is replaced, and MS58 is now the T4 replay mutant (Gate 1 R4-E3). | §4.3, TS15b (10) |
| E4 popup close and coalescing | **ADDRESSED:** it coalesces with Lua typing, which is safe | §3.2, §4.3, TS27 |
| E5 the `toPlainJson` premise | **ADDRESSED:** CONFIRMED, and the differences from `safeStructuredClone` are stated | §0, §2, §14 |
| E6 History presentation of trigger items | **ADDRESSED:** `studioScriptDeletedList(mode, n)` and `studioScriptDeletedRows(name, n)` | §4.1, §4.3, §6, TS15b (12) |
| E7 K1 evicts other kinds | **ADDRESSED** | K1, TS32 |
| Simpler path (MC-777) | **ADDRESSED.** The reviewer's option (a), deriving `whole` from "the run emptied the list", was weighed and not taken. On the `already` route nothing is planned forward, so the length before the run is unknown, and a V1 delete of the last row would also become whole. Option (b) keeps S7's "complete from its ops" with no list-state dependence, and costs older builds nothing (4.5). | §4.3, §4.5 |

### Gate 1 round 3 and the senior-advisor direction (draft 5)

| Finding | Disposition | Where |
|---|---|---|
| R3-1 content classes refuse same-list restores | **ADDRESSED** (the advisor's mechanism; the reviewer's option (a), as one enum key instead of a second key beside `whole`). Tagged trigger ops record the span. Acceptance compares the span with the live mode; content classes and the V2 clamp are removed. Scenarios A to C are accepted in their own list (TS15c) and refused after a switch (TS15b (3), (10)). TS15b (10) is replaced. | header, §4.1, §4.3, §4.5, N9, TS15b (9), (10), TS15c, MS53 |
| R3-2 label-agnostic tag rule; redo of a whole restore | **ADDRESSED:** N10 (listing follows the ops whatever the label) and N11 (a caller-supplied id for E); the closure table's last column; TS15b (13) and (14); MS59 and MS60. | §4.3, §4.6, TS15b, §9.1 |
| R3-3 `triggercode`-first rows and the legacy view | **ADDRESSED by derivation, not enumeration:** `hasEngineCase` and `runsOnEveryTrigger` in `triggerKinds.ts`. The every-trigger marker comes from the second, with wording that does not say Lua (key and part renamed). The legacy view is the Lua view with read-only code and the shared extra notes. TS36 and the TS37 product cover it, with MS61 and MS65. | §0, §3.2, §3.3, §3.4, §3.7, §5, §6, §8, TS36, TS37 |
| R3-4 two predicates for "unreadable" | **ADDRESSED:** seam-holdable (a plain object) gates the switch and the `list` restore; editor-readable gates menus. Every place cites the right one, and TS15, TS15b (11) and TS18 use both fixture kinds. | §3.2, §3.11, §4.3, §7 E-a / E-a′, D14, TS15, TS15b (11), TS18, MS54 |
| R3-E1 clamp order | **ADDRESSED:** the V2 clamp is gone. A `v2` item holds no index 0, and a `v1` item never enters a V2 list. | §4.3 |
| R3-E2 non-array list | **ADDRESSED:** T1 refuses every trigger plan on it, the restore rule included. | §4.3, §7 E-a′, D14, TS7, TS18 |
| R3-E3 "nothing is lost" and `MAX_DELETED` | **ADDRESSED:** K10; §4.3 and §12 now say "recoverable while listed". | §4.3, §11, §12 |
| R3-E4 TS37 bases | **ADDRESSED:** SC-2b, SC-3 and SC-10 merged. | TS37 |
| R3-E5 `v2Header` menu; one type source | **ADDRESSED:** a `v2Header` inside an event has no Edit. The type sets are `KNOWN_V2_TYPES` and `V1_EFFECT_TYPES`, exported by SC-2a; SC-0 reads no type set. | §0, §3.4, §10 |
| R3-E6 placement | **NOT ACCEPTED at round 4; corrected in draft 6.** Draft 5 wrongly said the scratch file and the worktree copy were identical. The committed spec now equals the scratch source (R4-E2, R5-E4). | header, §15 |
| Advisor: K8 | **ADDRESSED:** removed by T4 on replay (the advisor's preferred option, not the build-time-only one). | §4.3, §11 |
| Advisor: builder-side T3 | Design default D16, with its veto fallback. | §3.7, §13, TS38, MS63 |
| Round 3 Simpler path (one trigger-only key) | **ADDRESSED** as one enum, `span`, replacing `whole`: two keys would need combination rules. | §4.3 |

**Regression list: earlier failure scenarios and the invariant that now decides each.**

| Scenario (report) | Decided by | Test |
|---|---|---|
| N1 scenario 1: switch, Undo, Redo re-lists D without its whole property (round 2) | T2: inversion keeps `span: 'list'` | TS15b (6) |
| N1 scenario 2: the inverse replace lists E without its whole property (round 2) | T2: E's removes carry `list` | TS15b (1), (5) |
| N2: a restored row lands at index 0 ahead of the header (round 2) | span acceptance: the `v1` item is refused in V2; a `v2` run never names index 0 | TS15b (9), TS7 |
| N3: a switch or inverse replace over a non-object row (round 2) | the seam-holdable refusal (S7 R1) | TS15, TS15b (11) |
| N4: an import lands after the list changed mode (round 2) | T3, "starts from the mode it was offered in" (the row-0 recheck) | TS19 |
| R3-1 scenarios A, B and C | span acceptance; content is never read | TS15c |
| R3-2 redo trace: Undo then Redo of a whole restore loses E | N10 | TS15b (13), (14) |
| Draft 4's K8: replay of a switch after an outside append leaves a mixed list | T4 | TS15b (16) |
| Advisor: a `v1` row starting with Lua restored to index 0 of an emptied list | T3 after-check | TS15b (15) |

### Gate 1 round 4 (draft 6)

Round 4 accepted the span mechanism, R3-1 to R3-4 and the advisor's items. Neither substantive finding touches the inverse replace or whole items, so the Q5 option A fallback does not apply.

| Finding | Disposition | Where |
|---|---|---|
| R4-1 an empty-list switch is not a `list`-span plan, and T4's mode clause refuses it | **ADDRESSED, option (a).** T4 is run emptiness only and never reads the mode. T3 names the two mode-changing plans by what builds them (the switch, empty or not, and the `list` restore) and is a build-time property; replays are not re-evaluated. A new empty-list and row-0 trace covers every route. N3 records an absent list's creation, so undo returns the bytes. | §3.2, §4.3 (T3, T4, closure table, trace), §4.6 N3 and N9, TS7, TS14, TS15, TS15d, MS67, MS69, F23, K6, K12 |
| R4-2 the V2 view hides row 0's runnable effects | **ADDRESSED, option (a):** the V2 header note (`studioScriptsHeaderEffects` in the shared part `studio-scripts-extra`). §1.1 and §5 now say "as its own row or in a note that says it runs". | §1.1, §3.2, §3.3, §5, §6, TS37 (b), MS68, F24 |
| R4-E1 "runs on every trigger" overstates | **ADDRESSED:** three keys reworded ("checked on every trigger", "its conditions still apply", the Low Level gate) | §6 |
| R4-E2 placement claim false | **ADDRESSED:** the R3-E6 row and §15 corrected | §15, §16 |
| R4-E3 stale round 2 E3 row | **ADDRESSED:** marked superseded | §16 |
| R4-E4 the item parser cannot compare an item with its ops | **ADDRESSED:** the parser refuses an item without a valid `span`; "an item's span equals its ops'" is tested on items the service builds | TS7 |
| R4-E5 `studioScriptDeletedList(mode, n)` | **ADDRESSED:** a localised mode label, plural forms, and `studioScriptLegacy` for a `triggercode` list | §4.3, §6, TS15b (12), MS70 |
| Closure attack: a replay after an outside classic switch | **ADDRESSED** as a K6 line; F18 qualified | §11 |

**Regression list, round 4 additions.**

| Scenario (report) | Decided by | Test |
|---|---|---|
| R4-1: an empty-list switch refused on commit, undo, redo or the restore line | T4 limited to run emptiness; T3 build-time | TS15 (empty list), TS15d |
| R4-1: the undo of a switch that created a module's list leaves `[]` | N3 | TS14, TS15 |
| R4-2: row 0's effects after `v2Header` run unshown | the header note | TS37 (b) |

### Gate 1 round 5 (`[EDITORIAL]`) and lane A's PR check

| Finding | Disposition | Where |
|---|---|---|
| R5-E1 a tap on the pressed mode chip | **ADDRESSED:** it writes nothing and asks nothing, as in classic; V1 switches only while its chip shows | §3.2 (Mode switch, legacy-view row), TS15, TS36 |
| R5-E2 the creation record is unnamed in the format | **ADDRESSED:** `created: true`, trigger list only; an absent list counts as length 0 | §4.5, TS7, T4, K12 |
| R5-E3 stale `triggercode` grep count | **ADDRESSED:** 6 matches, case-sensitive, tests excluded | §0, §14 |
| R5-E4 stale placement line | **ADDRESSED:** the pre-commit copy and round-seed lines are removed, because the committed spec equals the scratch source | §15, §16 (R3-E6 row) |
| Lane A P1: the "delete only when empty" rule of `created` is unguarded | **ADDRESSED:** an outside-append cell over undo, the restore line and revert; MS71; F25; MS71 in SC-0's list | TS14, §9.1, §10, §11 |
| Lane A P2: `created` is not named beside `span` for S7-0 | **ADDRESSED** | §4.6 (N9 and the bullet after the table), §11 K12, §15 (S7-0 recheck) |
| Lane A P4: N3 reads as general | **ADDRESSED:** "(trigger list only; §4.5)" | §4.6 N3 |
| Lane A P5, regression E1, records E4: no round-5 table; "the four rounds"; stale process lines | **ADDRESSED** | header, §15, §16 |
| Lane A P6: a non-empty V1 switch needs `showDeprecatedTriggerV1` | **ADDRESSED** | TS15 fixture, §4.3 trace row 6 |
| Lane A records E3: the lock list predates #681 S3 and #709 L2 | **ADDRESSED** | §10 |
| Lane A regression E4: the `studioScriptDeletedList` example does not render | **ADDRESSED:** template `${mode}: ${n} triggers`, example "V2 rules: 12 triggers" | §4.3, §6 |

| Scenario (report) | Decided by | Test |
|---|---|---|
| Lane A P1: an undo after an outside append deletes `trigger` with the outside row | the `created` remove deletes the property only when it leaves the list empty | TS14 (outside append), MS71 |
