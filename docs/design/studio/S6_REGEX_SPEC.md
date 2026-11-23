# Studio S6: regex editing (spec)

Status: **draft 6, spec only** (2026-11-23), for yor42/RisuTanium #684 (stage S6 of #651, MC-3900). MC-3902: no S6 build starts before this spec merges.
- Draft 5 follows the senior-advisor direction after Gate 1 round 3. It drops S6's own history seam in favour of the S7 object-list op family ([S7_LORE_SPEC.md](S7_LORE_SPEC.md) §4, #685); keeps only the regex rows and rules; lists requests to that seam (§5.7); and folds in MC-4050..4052 and review 3's editorial findings.
- Draft 6 answers Gate 1 round 4 (S6, E-m..E-p) under `advisor-2.md`: R9 (journal tail-merge); S6's statements about seam internals become requirements on S7-0 with S6-owned tests (§5.3, §5.5); the S7-0 dependency is stated once (§8).
- Draft 4 answered review 2 (S4, E-a..E-f) and added classic parity (§1.1). Draft 3 answered review 1 and folded in MC-3997..3999. Draft 2 folded in MC-3990..3996 and added S6e.

Base: `origin/main` 71882fe16; every `file:line` is from that base unless marked `origin/main` 48691dfaa. "S7 §n" means [S7_LORE_SPEC.md](S7_LORE_SPEC.md) revision 6.

Builds on:
- [SLICE1_SPEC.md](SLICE1_SPEC.md): owner tree, live-item model, durable delete;
- [SLICE3_SPEC.md](SLICE3_SPEC.md) §1: regex replace is a long-text field;
- the S0a field registry (PR 678);
- **S7 §4**: the object-list ops (`objSet`, `objInsert`, `objRemove`), anchors, identity counts, `planObjStep`, the obj deleted item and its tag rule, labels, coalescing and the visit journal; S7 §7, the stored format.

Decisions used:
- DD-094, DD-100 ([../DECISIONS.md](../DECISIONS.md));
- MC-175, MC-223, MC-350, MC-774, MC-1119 (answer 6), MC-1758, MC-1812, MC-1827, MC-3399;
- MC-3890..3896, MC-3900..3902, MC-3990..3999, MC-4030, MC-4043, MC-4050..4052;
- MC-4008 (S7's lore counterpart of MC-4051).

Markers: **(design default)** is chosen here inside settled intent and is open to veto at Gate 1. **Rn** is a request to the shared seam (§5.7), answered in S7 r6.

## 0. Today (source-read)

| Fact | Anchor (`src/`) |
|---|---|
| A regex entry is `{ comment, in, out, type, flag?, ableFlag? }`. | `ts/storage/database.svelte.ts:1428-1436` |
| Hosts: `character.customscript`, `module.regex` (optional), per preset `botPreset.regex` (optional) with the active preset's working copy `db.presetRegex`. A group also has `customscript`. `db.globalscript` is applied by no runtime path. Chats hold no regex. | `database.svelte.ts:1485, :1663, :1209, :1849, :999`; `process/scripts.ts:39`; `process/modules.ts:1016` |
| The four edit stages merge preset, character, modules (stubs skipped) and run in `processScriptFull`. | `process/scripts.ts:469`; `process/modules.ts:1009-1020` |
| `edittrans` entries run only in the translator, merged preset, modules, character. | `translator/translator.ts:788-896` |
| **Effective flags**, the same pipeline in both engines. (1) With `ableFlag` off, the flag text is ignored: the main runtime uses `g`, and the translator `''`, which then becomes `g`. (2) With `ableFlag` on, every `<...>` group is removed first and parsed: comma-separated metas, `order N` sets the order, anything else is an action. (3) Then `flag \|\| 'g'`, trim, drop letters outside `dgimsuvy`, drop repeats, and an empty result becomes `u`. So `<cbs>` gives `g`, `<order 2>` gives `g`, `<move_bottom>u` gives `u`, `gi<cbs>` gives `gi`. | `scripts.ts:737-756, :535-550`; `translator.ts:801-833` |
| `<order N>` (N may be negative) sorts the merged list by N descending (stable) when some entry carries it with `ableFlag` on. | `scripts.ts:738, :747, :771-773`; `translator.ts:838-840` |
| Main engine: an entry runs when `type === mode` and `in !== ''`. `out` gets three rewrites: `$n` becomes a newline, `{{data}}` becomes `$&`, and an `out` ending in `>` gets a newline unless `<no_end_nl>`. The `cbs` action CBS-parses `in`. The result is CBS-parsed. With an `@@` `out` or any action, `reg.test` runs before the branches: `@@emo ` (with its space), `@@inject`/`inject` (only with a chat), `@@move_top`/`@@move_bottom` or a `move_*` action, `@@repeat_back`/`repeat_back` (only with a chat and no match); anything else falls to the plain replace. | `scripts.ts:527-555, :562-664, :730` |
| Translator: an entry runs when `in` is truthy. Only `$n` is rewritten. Only the `cbs`, `move_top` and `move_bottom` actions exist; `@@` is not read; there is no post-replace CBS. The result is a plain `text.replace(reg, out)`. | `translator.ts:797, :846-891` |
| A third copy of the flag pipeline, `deriveScriptFlags` (streaming span probes), runs `flag \|\| 'g'` **before** the group strip, so `<cbs>` and `<order 2>` give `u` there; its test pins that value. | `ts/chatShell/streamSpans.ts:129-145`; `streamSpans.test.ts:147` |
| An invalid pattern throws inside a per-entry `try`; that entry is skipped. | `scripts.ts:557, :776-781`; `translator.ts:892-894` |
| The script cache key covers `in`, `out`, `flag`, `ableFlag` and the order of that stage's entries. | `scripts.ts:191-199` |
| **Classic editor** (mounts and parts: §1.1). **Flag toggle bug:** the toggle removes the first occurrence of the letter **anywhere** in `flag`: turning off `s` in `<cbs>s` gives `<cb>s`. | `RegexData.svelte:31-46` |
| **Custom Flag check.** Its `onChange` runs on every change, so classic writes `flag = 'g'` whenever `flag` is empty, on turning on and on turning off. | `RegexData.svelte:163-167`; `lib/UI/GUI/CheckInput.svelte:46-48` |
| **Export.** `exportRegex(list)` writes `{ type: 'regex', data: list }` to `regexscript_export.json` through `downloadFile`. On Android that is the save picker, and a cancel shows nothing; desktop Tauri writes to Downloads; the web build downloads a blob. | `scripts.ts:37-49`; `downloadFile.ts:13-75` |
| **Import.** `importRegex(list)` picks one `.json` with `selectSingleFile` (the web view's chooser on every platform), requires `type === 'regex'` and a truthy `data`, then **pushes every element unchecked**. So a live list can already hold `null`, strings, or entries with missing or wrongly typed keys. | `scripts.ts:51-77`; `util.ts:64-73` |
| **Studio today.** Regex is shown read-only (owner kinds `regex` for character, module and preset; item name = `comment`; detail = `in → out`). The only regex write is the asset merge's `textEdit regex/<i>/out`, replayed only over scanned reference spans. | `ts/studio/ownerModel.ts:236-251, :341, :378, :443`; `ts/studio/itemText.ts:111-118`; `lib/Studio/StudioDetail.svelte:207-208, :258-259`; `ts/studio/assets/referenceTargets.ts:299-302, :442`; `ts/studio/history/historyModel.ts:991-1009` |
| **Shared preset array.** The active preset's working copy and its stored slot share one array (proxy): `presetFromWorkingSettings` stores `regex: db.presetRegex`, and `setPreset` assigns `db.presetRegex = newPres.regex ?? []`, neither cloned. | `database.svelte.ts:2392, :2550` |
| **History store.** Per-owner cap 2 MiB of counted bytes (`CAP_BYTES` 4 MiB / 2). The keep walk takes the restore point, then `deleted`, `undone` and `done`, each newest to oldest, and **stops** at the first entry that does not fit: that entry and everything after it are dropped. | `history/studioHistoryStore.ts:16-25, :613-688` |

## 1. Scope, non-goals and hosts

**In scope.** Regex editing in Studio for the character, a module and every preset, active or not (MC-3993):
- per entry: name, find, replace, the stage ("Disabled" switches an entry off, MC-3990), the custom-flag switch, and the flags (letters, actions, order);
- list operations: add, delete with durable undo, move, duplicate (MC-3995);
- history: owner history, undo, redo, revert, restore to when Studio opened (this session only for the list, MC-4051), and the deleted-items list;
- pattern validation that warns and writes (MC-3991), a per-entry tester (MC-3992), regex JSON import and export (MC-3996, S6e) and a windowed list view (MC-3399).

**Non-goals.**
- Group regex: groups become Studio owners in S8 (MC-3901), and the setters refuse groups today (`studioSetters.ts:54-57, :121-123`).
- Chat owners and `db.globalscript`.
- An enabled switch (MC-3990) and a preset save chip (MC-3994, #666).
- Lore (S7), and the shared op family itself (S7 §4; S6 only adds its rows; R1-R9 are answered in S7 r6, §5.7).
- The store keep walk (MC-4052, #716).
- Runtime regex behaviour, other than the pure flag extraction of §6.1. The classic editor and its import stay unchanged until Studio replaces classic (MC-4030).

**Hosts and where each write lands.**

| Host | Owner key | Live list | Write rule | History |
|---|---|---|---|---|
| Character | `character:<chaId>` (`history/ownerPhase.ts:32-34`) | `customscript` | Inside the action's one `writeLiveCharacter` call, which re-finds the character by id and marks it (`liveCharacterWrite.ts:13-24`). All `resolveLiveTarget` guards apply (`studioSetters.ts:96-135`). | Stored while the phase is `ready`, strict parse (`historyModel.ts:613-654`). |
| Module | `module:<id>` (`ownerPhase.ts:40-42`) | `regex`; absent reads as `[]` | Copy-on-write through `writeLiveModule`: a new module object holding a new `regex` array, in one slot assignment (`studioSetters.ts:576-619, :678-692`). The module must be loaded and not share its id with another slot (`studioSetters.ts:73-92`; `StudioDetail.svelte:81-95`). | Stored while `ready`, claim `m:<id>` (`ownerHistory.svelte.ts:330-345`). |
| Preset | session key `preset:<presetId>` (`edit/presetTarget.ts:15-17`; `history/sessionKinds.ts:14-17`) | Active: `db.presetRegex`. Inactive: `botPresets[i].regex` (absent reads as `[]`). The live copy is decided by id at every read and write (`presetTarget.ts:28-47`). | A fresh array is assigned to the live copy (E7). | Memory-only (MC-1758; `ownerHistory.svelte.ts:1218-1239`), with the `studioBannerPresetSession` banner (MC-3892) and no chip (MC-3994). Needs R6. |

**Preset copy-on-write.** An in-place change of the shared array changes the working copy and the slot together, and the dirty mark then depends on which proxy path the write took (`storage/dbWriteHook.ts:47-50`). Assigning a fresh array to exactly the live copy avoids both: it is a direct key write on a known proxy, marked as a top-level setting or under `botPresets` (the two marks #650 verified, `edit/tests/presetWriteMark.svelte.test.ts:50-66`), and it breaks the aliasing. The engine reads `db.presetRegex` (`scripts.ts:469`), and `saveCurrentPreset` later copies it into the slot (`database.svelte.ts:2435-2454`). An inactive preset's entries do not run until the preset is active, and its editor says so (MC-3993).

**Preset selection (#703 on `origin/main` 48691dfaa).** S6c reuses `studioScreen.selectedPresetId`, `presetIdOfKey`, `followStudioPreset`, `presetStateOf(id)` and the gone-preset refusal `studioRefusalPresetGone` (MC-3896).

### 1.1 Classic parity (MC-4030, MC-4043, MC-4050)

MC-4030: "studio is planned to replace classic. so studio must be feature complete compared to legacy." A link out to classic is allowed only as an interim step with a follow-up ticket. MC-4043: app-wide settings shown beside a form stay in Settings; per-item fields must be in Studio. The three classic regex blocks show no app-wide setting (`BotSettings.svelte:814-816` holds only the list).

| Classic part | Classic source | Studio | Stage |
|---|---|---|---|
| Name (`comment`); "unnamed" fallback | `RegexData.svelte:96, :113-116` | name input; row name with `sidebarUi.unnamedScript` | S6a |
| Stage select, 6 values | `:117-127` | stage select; unknown values kept (E5) | S6a |
| Find (`in`) | `:128-129` | compact long-text field (D1) | S6a |
| Replace (`out`) with CBS highlight | `:130-133` | long-text field, `html+cbs` mode | S6a |
| Custom Flag check (`ableFlag`) | `:162-167` | switch (§2) | S6a |
| Letter flags g, i, m, u, s; actions move_top, move_bottom, repeat_back, cbs, no_end_nl | `:65-79, :137-153` | chips (E6; the classic toggle bug is not carried) | S6a |
| Order number, negative included | `:48-63, :155-158` | order control (E6) | S6a |
| Open or close an entry | `:87-95` | select an item → item editor | S6a |
| Chat refresh after name, stage and replace edits | `:114-120, :131-133` | one `ReloadGUIPointer` bump per such step (D4) | S6a |
| Delete, after a confirm | `:98-107` | Delete, no confirm, toast with Undo, deleted list (DD-100; intended difference) | S6b |
| Drag reorder | `RegexList.svelte:23-49` | Move up/down/top/bottom; drag on wide layouts (D2) | S6b |
| Windowed list; empty text | `RegexList.svelte:24, :86, :88` | windowed list view; `sidebarUi.noScripts` | S6b |
| Heading help `<Help key="regexScript"/>` | `CharConfigPanel.svelte:810` | same help on the list heading (D10) | S6b |
| Add | `CharConfigPanel.svelte:813-824`; `ModuleMenu.svelte:196-206, :311-313`; `RegexList.svelte:103-112` | Add regex (E4) | S6b |
| Export | `CharConfigPanel.svelte:825-827`; `ModuleMenu.svelte:314-316`; `RegexList.svelte:113-115` | Export (§6.3) | S6e |
| Import (unchecked) | `CharConfigPanel.svelte:828-837`; `ModuleMenu.svelte:317-319`; `RegexList.svelte:116-118` | Import, strict (MC-3997; K7) | S6e |
| Hosts: character of type `character`, each module, the **active** preset only | `CharConfigPanel.svelte:804`; `ModuleMenu.svelte:307-309`; `BotSettings.svelte:815` | character and module; every preset (MC-3993) | S6a; S6c |
| Group regex: no classic UI (the scripts tab is redirected away for a group) | `CharConfigPanel.svelte:246-249` | groups become owners in S8 (MC-3901) | S8 |
| Private character: classic shows "not allowed" | `CharConfigPanel.svelte:307, :423-427` | no form (`studioSetters.ts:54-57`); parity holds | — |
| Module `regex ??= []` on opening the submenu | `ModuleMenu.svelte:238` | not an operation: viewing writes nothing (E3); the first insert creates the list (E8) | — |

**Interim link-outs (MC-4050; follow-ups #713 and #714):**
- field edits on an element that is not a well-formed entry (§2.1). Classic shows an object such as `{comment: 'x', in: 123, out: '', type: 'editinput'}` and fails on `null`, a string or an object without `comment` (`RegexData.svelte:96` reads `value.comment.length`). Repair in Studio is #713;
- a list that is not JSON-safe (§2.1 M-c), #713;
- a module whose id another slot shares: Studio refuses writes for every module kind (`studioSetters.ts:84-86`), while classic edits the module it opened. Studio-wide, #714.

**Outside S6 (other kinds on the same classic screens):** character `backgroundHTML` and trigger scripts (`CharConfigPanel.svelte:807-808, :840-841`), module `backgroundEmbedding` (`ModuleMenu.svelte:308`; Studio's module `html` kind, `ownerModel.ts:344`). They are per-item fields (MC-4043), so their parity belongs to the stages of those kinds.

## 2. The entry: fields and edit rules (MC-175)

Characters, modules and presets travel in `.bin` as they are, both ways (MC-175). Studio leaves an entry exactly as the classic editor would and never touches what it does not edit.

**Well-formed entry.** A plain JSON object in which:
- `comment`, `in`, `out` and `type` are strings;
- `flag`, if present, is a string;
- `ableFlag`, if present, is a boolean.

Other keys may hold any JSON value. This is also the import shape rule (§6.3, MC-3997). Only well-formed entries are editable; anything else follows §2.1.

| Field | Studio control | Rule |
|---|---|---|
| `comment` (name) | single-line input | as stored |
| `in` (find) | compact long-text field, plain mode (D1) | as stored |
| `out` (replace) | long-text field, `html+cbs` mode with CBS problems and tokens (SLICE3 §1) | as stored |
| `type` (stage) | select of the 6 known values; "Disabled" switches the entry off (MC-3990) | an unknown string shows as "Other: {value}" and is written only when the user picks another value (E5) |
| `ableFlag` | switch | Absent means off. **On:** writes `true`, plus `flag: 'g'` when `flag` is absent or empty (classic parity). **Off:** writes `false` and leaves `flag` alone. Classic also writes `'g'` when `flag` is empty; that is harmless, because off means `g`. |
| `flag` | letter chips, action chips and an order number, shown only while `ableFlag` is on | unknown tokens are kept (E6) |
| any other key | not shown | kept (E1) |

Edit rules (test targets in §7):
- **E1 Unknown keys survive.** A field edit writes a copy with only that key changed. Insert, duplicate, import and restore write the whole stored entry.
- **E2 No undefined.** An optional key that is absent stays absent until the user sets it. Removing a key deletes it (`{had:false}`, S7 §4.1); it is never assigned `undefined`, `null` or `false`.
- **E3 Viewing writes nothing.**
- **E4 Add creates the classic shape** `{ comment: '', in: '', out: '', type: 'editinput' }` (`RegexList.svelte:104-109`; `CharConfigPanel.svelte:816-821`).
- **E5 Unknown stage values survive.** The runtime never runs them (`scripts.ts:531`).
- **E6 Flag edits are token-aware.** `flag` is read as a sequence of `<...>` groups and single characters.
  - A letter toggle changes only letters outside every group.
  - An action toggle off removes that name from its group. The group is dropped when it empties, and the other comma-separated names are kept (`scripts.ts:743-753`). An action toggle on appends `<name>`.
  - The order control accepts any integer, negative included (`/<order (-?\d+)>/`, `RegexData.svelte:49, :58`; `parseInt` at `scripts.ts:747`). It replaces the number in the existing `order N` meta, or appends `<order N>`. Clearing it removes only that meta.
  - Everything else stays in place. The classic `replace` bug is a mutant this must kill.
- **E7 Copy-on-write** for modules (a new module object and array) and presets (a new array for the live copy). A character write may mutate inside `writeLiveCharacter`.
- **E8 An absent list** reads as empty. The first insert creates it as an array, which is equivalent at runtime (`modules.ts:1016`; `database.svelte.ts:2550`) and in upstream. Studio never deletes the list key.

Fork-only fields: none.

### 2.1 Malformed live elements (from MC-175, the read-back rule and MC-4050)

These come from upstream data through the unchecked classic or upstream import (§0), so Studio handles them without loss (MC-175, MC-223). They are not fork-local corruption (MC-011).

- **M-a: an object that is not a well-formed entry** (a required key missing, or a key of the wrong type) is a read-only row: "Unreadable entry" with the reason, plus the name when `comment` is a string. It offers **Delete and Move** (`objRemove`/`objInsert` carry any object, S7 §4.1). Field edits and Duplicate are refused with `precondition` (design default D7: Studio does not multiply data it cannot edit). Try it is not offered. Editing it in Studio is #713 (MC-4050).
- **M-b: an element that is not an object** (`null`, a string, a number, an array) is an **inert** row: "Unreadable entry" with the reason and no action. No op is ever planned with it as its subject, because S7's ops carry objects only. Ops on the other rows of the same list must still plan and apply (R1). Classic cannot show or delete such an element either (§1.1). Repair is #713. (Design default D7; it replaces draft 4's JSON-value payloads.)
- **M-c: a list that is not JSON-safe is read-only as a whole (deep rule).** A list is JSON-safe when every element, at every depth, is `null`, a boolean, a finite number, a string, an array or a plain object whose own keys all hold JSON-safe values. So `undefined` anywhere (an element, or a key holding `undefined`), a function, a symbol, a bigint, a non-finite number, a non-plain object or a cycle makes it not JSON-safe.
  - Reason: S7's anchor and copies use `JSON.stringify` semantics (`NaN` becomes `null`, an `undefined` key is lost; S7 §4.1). An undo or restore of a copy would therefore write a changed value, against MC-175.
  - The list view says the list cannot be edited in Studio and offers the classic editor (interim, MC-4050, #713). No op, journal entry or import is made for it.
  - Reachability: the live database is msgpack-decoded (`storage/risuSave.ts`), and msgpack can carry `undefined`. No regex writer in this tree writes it (classic; the MCP tools `process/mcp/risuaccess/characters.ts:811-818` and `modules.ts:674-681`; card import from JSON).
- **M-d: field edits apply only to well-formed entries.** An `objSet`'s `before` and `after` are always well typed:
  - `{had:true}` strings for the four required keys;
  - `{had:false}` or the right type for `flag` and `ableFlag`.

  A forward or undo replay that meets an element at `index` which is no longer well-formed is refused by the anchor, because the anchor covers the whole entry.

## 3. UI

**Placement (SLICE1 §2-3; details are design defaults).**
- Selecting an owner's `regex` kind shows its **list view**; selecting an item shows its **item editor**.
- On phones (< 600 px) these are full-screen detail screens; Back goes item → list → tree.
- For a live owner they replace the read-only text and note (`StudioDetail.svelte:214-215, :258-259`). A private, stub or shared-id owner keeps today's notices (`StudioDetail.svelte:193-201, :232-234`).
- "Open in classic editor" stays.

**List view.**
- **Windowing.** One single-line row per element, windowed with `createWindowHost` + `WindowedSegment`, as `RegexList.svelte:24, :88` and `StudioCombined.svelte:52, :107` do (MC-3399). An empty list shows `sidebarUi.noScripts`.
- **Heading.** `regexScript` with `<Help key="regexScript"/>` (D10).
- **Row contents.** Position, name (or `sidebarUi.unnamedScript`), stage, and markers:
  - "Disabled";
  - an `order N` chip, only when `ableFlag` is on and the flag carries `order` (`scripts.ts:738`);
  - the problem marker of §6.1.

  Unreadable rows follow §2.1.
- **Row menu** (SLICE1 §3): Move up / down / to top / to bottom, Duplicate (MC-3995), Delete. Wide layouts also allow dragging (D2).
- **Toolbar.** Add regex (appends, opens the editor, focuses the name), Import and Export (§6.3).
- **Notes.** The order note (D5). An inactive preset gets the line that its regex does not run in this chat (MC-3993).

**Item editor**, top to bottom:
1. Name
2. Stage
3. Find
4. Replace
5. Custom flags switch
6. While custom flags are on: letter chips g, i, m, u and s; action chips move_top, move_bottom, repeat_back, cbs and no_end_nl; the order number; an "Also kept: {tokens}" line for unknown tokens
7. Problems line (§6.1)
8. "Try it" (§6.2)

Labels go above the controls. Text fields write through the long-text port (`longText/fieldWrite.ts:16-22`) with typing coalescing. The select, the switch and the chips write at once, one step each.

**Status chip.** Character: the visit ack (`StudioDetail.svelte:236`). Module: the module ack (`StudioDetail.svelte:227`). Preset: none (MC-3994).

**Restore sheet.** The regex line and the earlier-visit note of §5.3 (through R4).

**Reuse.**
- Components: `LongTextField`, `StudioStatusChip`, `Help`, the windower, and the history panel and restore sheet.
- Existing keys: `sidebarUi.flag*`, `customFlag`, `orderFlag`, `noScripts`, `unnamedScript`, `editInput`, `editOutput`, `editProcess`, `editDisplay`, `editTranslationDisplay`, `disabled`, `name`, `regexScript`, `import` and `export` (`lang/en.ts:2229-2233, :2268, :3098, :4572-4590`).

**New `en.ts` keys.** Final names are set at build. The 7 other locales come from the translator in the same PR (MC-058), and localeParity must pass.

| Stage | Keys |
|---|---|
| S6a | `studioRegexFind` "Find (pattern)", `studioRegexReplace` "Replace with", `studioRegexStage` "When it runs", `studioRegexStageOther(v)` "Other: {v}", `studioRegexFlagsKept(t)` "Also kept: {t}", `studioRegexOrderNote` "Order flags change the run order across all owners.", `studioRegexUnreadable(reason)` "Unreadable entry: {reason}", reason texts `studioRegexWhyNotObject` / `studioRegexWhyField(field)` "{field} is missing or not text" / `studioRegexWhyFlag` / `studioRegexWhyAbleFlag`, `studioRegexListNotEditable`, the restore line `studioRegexRestoreLine(n)` "Regex: undo {n} changes", `studioRegexRestoreEarlierVisit`, `studioRegexRestoreChanged`, field names for history labels |
| S6b | `studioRegexAdd`, `studioRegexMoveUp` / `MoveDown` / `MoveTop` / `MoveBottom`, `studioRegexDuplicate`, `studioRegexDelete`, `studioRegexDeleted(name)` (toast with Undo), `studioRegexRestoreTaken` "Can't restore: this list now holds more identical entries than when it was deleted." (the count refusal, R4), `studioRegexRevertMixed` "Can't revert: the range includes an asset merge that changed regex text." (R5) |
| S6c | `studioRegexPresetNotInChat` "This preset is not active, so its regex does not run in this chat." |
| S6d | `studioRegexInvalid(msg)`, `studioRegexEmptyFind`, `studioRegexNotCheckedCbs`, `studioRegexTry*` (title, sample, run, no match, n matches, directive not run, CBS not run, one entry only, translation engine, not run because the stage never runs) |
| S6e | `studioRegexImported(n)`, `studioRegexImportNotRegex`, `studioRegexImportEmpty`, `studioRegexImportBadEntry(n, first)` "{n} entries are not regex entries; first: {first}". `first` is one of the S6a reason texts with its position. |

That is about 45 new keys. History step texts come from S7 §4.3's `obj` label with `list: 'regex'`. Whether the label text is generic or per list follows #685's keys.

## 4. List operations

Each operation is one owner-history step (SLICE1 §5), planned and replayed by `planObjStep`: all or nothing, by anchor and identity count (S7 §4.0-4.2). Indexes are positions at the time of the op. A regex row's identity is its content only (§5.1), so twins made by Duplicate are counted, as S7 counts id-less twins.

| Operation | Effect | Ops (S7 §4.1) | Label action (S7 §4.3) |
|---|---|---|---|
| Add | append the E4 entry | `objInsert(length, entry, counts)` | `add` |
| Delete | remove element `i` | `objRemove(i, entry, counts, deletedId)`; obj deleted item with one element (S7 §4.4) | `delete` |
| Restore deleted (toast Undo, History "Deleted items") | insert at the old index, clamped | S7 §4.2 "Restore from History"; a count refusal shows `studioRegexRestoreTaken` (K13) | the existing label kind `{ kind: 'restoreDeleted', deletedId }`, not an `ObjAction` |
| Move `from` → `to` | `to` in post-removal coordinates (`greetingListOps.ts:62-83`) | `objRemove(from)` + `objInsert(to)` in one step | `move` |
| Duplicate (MC-3995) | insert a deep copy after `i`, same name, all keys | `objInsert(i + 1, copy, counts)` | `duplicate` |
| Import (MC-3996) | append the file's entries | one `objInsert` per entry, one step | `import` with `count` |
| Field edit | one key changed | `objSet(i, field, before, after, anchors)`; turning custom flags on with `flag` absent or empty is two `objSet` in one step | `edit` with `field` |

On an M-a row only Delete and Move apply; an M-b row and every row of an M-c list get no operation (§2.1).

**Delete.**
- DD-100 and SLICE1 §5 ("never asks first", `SLICE1_SPEC.md:76, :111, :116`): no confirm; one toast per delete, with Undo; focus moves to the next row, or else the previous one.
- **Later edits (DD-100).** The deleted item stays in History's deleted list after later edits until Studio closes. The list is capped at `MAX_DELETED = 50`, and S7's obj and greeting items count together (`historyModel.ts:21`; S7 §4.4).
- **Reload (MC-1119 answer 6).** Survival across a reload is "kept on this device with a size cap, oldest evicted first". It holds only while the owner's history is stored: a character or module owner in the `ready`, writable phase.
  - In `memoryOnly` (another tab holds the claim, or the store is unwritable), and for every preset, the item lasts until the page closes: nothing is saved outside `ready` (`ownerHistory.svelte.ts:1118-1120, :1189-1196`). The banners say so: the memory-only phase banner, and `studioBannerPresetSession` for presets (MC-3892).
  - When the record does not fit the 2 MiB owner share, the keep walk keeps the restore point first, then deleted items, then steps, newest first, and drops everything from the first entry that does not fit (`studioHistoryStore.ts:613-688`). S6 adds no list to the restore point (MC-4051), so a regex list never takes the restore point over the cap. A single over-cap item or step still drops everything after it: store keep-walk ticket #716 (MC-4052), K10.
- A regex delete is never refused for a memory-only phase. Only asset-row removals consult `removalRefusal` (`ownerHistory.svelte.ts:1106-1112, :1129-1135, :1245-1262`).

## 5. History: regex in the shared seam

S6 defines no op, deleted-item shape, anchor, planner or journal of its own. All of them are S7's (§4). This section states only the regex rows S6 adds to S7's tables, the regex builder rules, and what S6 needed from #685 (§5.7, answered in S7 r6).

### 5.1 Regex rows in the S7 tables (append-only; names are stable history identities)

| S7 table | Regex row |
|---|---|
| `ObjListName` (S7 §4.1) | `'regex'` |
| `OBJ_LIST_HOLDERS` | character → `customscript`, module → `regex`; session kind `preset` through its session spec (R6) |
| `OBJ_LIST_IDENTITY` | `content` only: no `id`, no folder key |
| Field table (R2) | `comment`, `in`, `out`, `type`: text, required. `flag`: text, `{had:false}` deletes it. `ableFlag`: bool, `{had:false}` deletes it. |
| Anchor | the S7 anchor, with no key excluded (R2) |
| Asset-merge text prefix for the mixed-revert rule (R5) | `regex/` (`regex/<i>/out`) |
| Refusal and line keys (R4, R5) | `studioRegexRestoreLine`, `studioRegexRestoreEarlierVisit`, `studioRegexRestoreChanged`, `studioRegexRestoreTaken`, `studioRegexRevertMixed` |

### 5.2 Regex builder rules
- A field edit is one `objSet` on a well-formed entry (M-d), and its value is typed by the field table. A flag chip or order edit is an `objSet` of `flag` with the whole new flag text.
- **Coalescing** follows S7 §4.2: typing in one key of one entry within `COALESCE_MS`.
- **Records hold no live objects.** Every `entry` an op records is a fresh plain copy, never a live object or proxy. A Svelte proxy keeps its writes in its own sources (svelte 5.57.3 `src/internal/client/proxy.js:271-339`), so a recorded proxy would follow later classic edits.
- **Duplicate and import copies** are deep copies made through canonical JSON (`JSON.parse`), so a `__proto__` key stays an own property.
- **No op on an M-b element or an M-c list** (§2.1).

### 5.3 Restore to when Studio opened (MC-4051)

Restore-to-open covers a regex list **for this session only** (MC-4051). S6 uses S7 §4.6's visit journal and does not restate how it works. Instead it places these requirements on S7-0 as merged with R1-R9 (§8); each has an S6-owned test that fails if the merged seam does not provide it:

| # | Requirement on S7-0 | S6 test |
|---|---|---|
| J1 | No regex list ever enters the stored restore point; `RESTORE_PATHS_BY_KIND` gains no regex path. | T34 (e), T39; M43 |
| J2 | A regex-only visit offers this visit's point with the regex line "Regex: undo n changes". | T34 (a) |
| J3 | **Retained memory follows runs of edits, not keystrokes or steps (R9):** consecutive edits to one field of one row, with or without pauses, undo or redo between them, leave one journal entry of about two field values. | T34 (g), (h); M48, M49 |
| J4 | A field edit's work follows the edited entry, not the list. | T34 (f) |
| J5 | Choosing the line restores the regex list to its visit-start bytes. A refused regex line leaves the list as it is with `studioRegexRestoreChanged`, while the field writes and any other list's line on the same owner proceed (each list plans separately, R4). | T34 (b), (d), (i); M50 |
| J6 | After a reload, or Android ending the app, the stored steps and deleted items remain within the cap (§4). An earlier visit's point shows its field rows and `studioRegexRestoreEarlierVisit` for an owner holding a regex list, and never a regex line. | T34 (c) |

Presets keep the line until the page closes (memory-only).

This narrows MC-1812 and MC-1119 answer 6 for entry lists (MC-4051).

### 5.4 Persistence and older builds

| Owner | Record | Older builds |
|---|---|---|
| Character | stored v2 while `ready` | **71882fe16 and earlier** refuse every obj shape whole (S7 §7.2). **A build with S7 but not S6** must refuse a record that holds `list: 'regex'` whole (R8). The version stays 2 (MC-1827). |
| Module | stored v2 while `ready` | Same. The new parser accepts regex shapes on a module record because the holder table names module (R3). |
| Preset | memory-only (MC-1758) | Never stored. |

MC-350: no data-format change for characters, modules or presets, and the history store stays v2. No migration.

### 5.5 Size (MC-3998; advisor direction 4)

Every regex payload channel. `E` is one entry's JSON (a display `out` can be tens of KB); `F` is one field value.

| Channel | Stored size | At the owner cap |
|---|---|---|
| Field step (`objSet`, coalesced) | about 2 F, plus the label | Kept newest first; older steps drop first. |
| Add, Duplicate | about E | same |
| Delete | about 2 E (the step and the deleted item) | Deleted items are walked before steps. About 40 deleted 25 KB entries fill an owner's share, and no step is then kept (R7 of the advisor). |
| Move | about 2 E (remove and insert) | same |
| Import of k entries | about the sum of the k entries' E | A step larger than the share is never stored, and while it is the newest, **no** `done` step is kept (K10). Measured at S6e (T40). |
| Restore-line step, revert step | the sum of the inverted ops' entries | as Import |
| Restore point | **no list** (MC-4051) | unchanged |
| Memory: the record | capped by count (`MAX_DONE`, `MAX_UNDONE`, `MAX_DELETED`, `historyModel.ts:19-21`), not by bytes; presets included | — |
| Memory: the visit journal (J3, R9) | **not capped.** It holds one entry per run of edits to one field of one row (about 2 F), plus one per insert or remove (about E). An import's entries stay reachable for the visit even after its step leaves the record. It is released when the line applies or Studio reopens. | — |

Store-wide: `CAP_BYTES` is 4 MiB for all owners and eviction removes whole owners, oldest touched first (`studioHistoryStore.ts:17, :781-806`). Two regex-heavy owners can evict every other owner's history. That is the existing policy (K10).

### 5.6 Critical contracts and failure scenarios (regex part)

Contracts:
1. the persisted Studio history record with the regex rows (the seam's contract is S7's);
2. the upstream shape of persisted regex lists (MC-175), including what import adds;
3. dirty tracking of the preset copies and the module slot.

Each requires opus-reviewer at Gate 2 for the stages that change it (§8).

| # | Failure | Guard | Test |
|---|---|---|---|
| F1 | An older build misreads a regex record. | S7 §7.2; R8. | T38 |
| F2 | A regex shape lands on a chat record, or is refused on its own character or module record after a reload. | §5.1 holder rows; R3. | T38, T11 |
| F3 | An edit drops an unknown key, writes `undefined`, or adds a key by viewing. | E1-E3. | T2-T4 |
| F4 | An active-preset edit lands in the slot, or an inactive one in the working copy. | The live copy is decided by id per write. | T17 |
| F5 | A preset write mutates the shared array or is not marked. | E7; mark test. | T18, T19 |
| F6 | A module write reaches a stub or a shared id, or mutates the live module in place. | Module guards; `writeLiveModule`. | T15 |
| F7 | A flag toggle corrupts an action token. | E6. | T6 |
| F8 | The stage select overwrites an unknown stage. | E5. | T5 |
| F9 | A deleted entry is lost or misplaced within the cap. | S7 §4.4; §4. | T11, T39 |
| F10 | An import writes a non-upstream-shaped value or a partial file, or writes to another owner. | §6.3. | T26-T32 |
| F11 | An op is planned on a malformed element or a non-JSON-safe list, or a plan throws on a list holding one. | §2.1; R1. | T35, T36, T41 |
| F12 | A whole regex list enters the stored restore point and crowds out deleted items and steps. | MC-4051; §5.3. | T34, T39 |
| F13 | A revert mixes a regex obj step with an asset merge's `regex/<i>/out` text edit. | R5. | T42 |
| F14 | Typing into a large `out` retains one full field value per keystroke or per step until the visit ends (a renderer OOM on a low-spec phone). | J3; R9. | T34 (g), (h) |

### 5.7 Requests to the shared seam (#685), answered in S7 r6

The full fit analysis is the #684 designer note `seam-fit.md`. None of R1-R9 changes a stored lore shape; R9 changes what the lorebook line's `n` counts. S7 r6 answers every request (S7 §18, 2026-11-23); each entry below ends with where, and with the S7 tests and mutants. The answer is in the S7 spec, not yet in code: if one is missing from merged S7-0, S6a carries it (§8). S6's own tests for the requests stay in §7.

- **R1. Totality.** The anchor, the identity functions and the counts must not throw on a live element that is not a plain object. Such an element holds no identity. Regex lists hold such elements through classic `importRegex` (§0); lore lists can hold them through classic `importLoreBook`. *Answered in S7 r6 §4.1a, §4.2 (S7 T54, M63).*
- **R2. A per-list field table.** `OBJ_LIST_FIELDS[list]` (field kinds, `{had:false}` allowed or not) replaces `LORE_FIELDS` in the parser, the `objSet` precondition and `ObjLabelField`. The anchor's `bookVersion` exclusion becomes a per-list option. *Answered in S7 r6 §4.1, §4.1a, §4.3 (S7 T56, M65, M67).*
- **R3. Acceptance per (list, kind).** The parser and `isOpAllowedFor` accept an obj op or item only on a kind that `OBJ_LIST_HOLDERS[list]` names. S7 §7.1 states acceptance per owner kind. *Answered in S7 r6 §4.1a, §7.1 (S7 T55, M64; S7 tests it with a replaced `probe` table, and the regex rows' own tests stay with S6).*
- **R4. A per-list journal and line.** The journal is kept per owner, visit and list. There is one restore line per list with entries, and **each list's line plans separately**: a refused line leaves its list as it is and shows that list's refusal, while the other lists' lines and the field writes proceed. The line, the earlier-visit note, the changed refusal and the Restore from History count refusal (`studioLoreRestoreIdTaken` for lore) take their keys from the list's row. *Answered in S7 r6 §4.1a (keys), §4.6 (S7 T58, M68).*
- **R5. Mixed revert for every list.** The mixed-revert refusal covers each list's asset-merge prefix (`regex/` as well as `lore/`), with its key from the list's row (`studioRegexRevertMixed` for regex). *Answered in S7 r6 §4.2 (S7 T58, M69).*
- **R6. Session-kind holders.** `OBJ_LIST_HOLDERS` may name session kinds through their session spec. The adapter supplies `objList` and the writer, and nothing is stored. *Answered in S7 r6 §4.1a (S7 T55, M70; S7 adds no session row, and S6c owns the preset adapter test).*
- **R7. Worker protocol test.** Obj payloads through `diffEntry` and `applyEdits`: an unknown key shaped `{had: true, value: 1}`, an own `__proto__` key, and nesting deeper than 8 (`studioStoreProtocol.ts:106-159`). *Answered in S7 r6 §4.1a (S7 T57).*
- **R8. Unknown names refuse whole.** A record with an unknown list name, field or label field is refused whole. *Answered in S7 r6 §4.1a, §7.2 (d) (S7 T56, M66).*
- **R9. Journal tail-merge.** An applied `objSet` merges into the journal's last entry when that entry is an `objSet` on the same list, index and field and its `anchorAfter` equals the new op's `anchorBefore`, whatever the route (commit, undo, redo) and regardless of step or pause. The merged entry keeps the first `before` and `anchorBefore` and the last `after` and `anchorAfter`. The merge replaces the tail with a new op object; it never mutates an op, because record steps hold the same objects. Otherwise the op appends. #685 states whether a merged entry that nets to no change is dropped, since that decides what the line's `n` counts. *Answered in S7 r6 §4.6, §10.1, §11 (S7 T53, M58-M62). S7 r6 drops a netted-out entry, so `n` counts only real changes. The merge builds a new op object, so it never rewrites a recorded step (the V-1 refinement; S7 §4.6, T53 (g), M71).*

## 6. Validation, tester, import and export

### 6.1 Effective flags and validation (MC-3991: warn and write)

**One pure function.** `effectiveRegexFlag(flag, ableFlag) → { flags, actions, order }` implements the whole pipeline of §0: the group parse of `scripts.ts:737-756` (with `ableFlag` on), then the normalisation of `scripts.ts:535-550`. It is extracted as **one** function, so the group strip cannot be left out. The work goes in this order:
1. Characterisation tests pin the base runtime's answers (T20).
2. `runScriptPass` switches to the function.
3. The translator's copy (`translator.ts:801-833`) may adopt it in the same stage; T20 then covers both.

**The streaming copy stays.** `deriveScriptFlags` (`chatShell/streamSpans.ts:129-145`) differs and is pinned by `streamSpans.test.ts:147`. S6d leaves it alone (K9).

**Validation.**
- After each pause, `in` is compiled with the effective `flags`.
- On failure, the browser's error shows on the problems line and as the row marker. The edit is still written.
- An empty `in` gets a note: "An empty pattern does nothing" (`scripts.ts:527`; for `edittrans`, `!in`, `translator.ts:797`).
- An `in` that the `cbs` action parses first gets a note: "Checked only after CBS runs" (`scripts.ts:553-557`; `translator.ts:847-849`). This applies only when `cbs` is among the effective actions.

### 6.2 Tester (MC-3992: per-entry "Try it")

"Try it" is a collapsible section in the item editor. The sample text is kept in memory only. It runs this one entry with the effective flags of §6.1, through **the engine of the entry's stage**:

| Stage | Rules |
|---|---|
| `editinput`, `editoutput`, `editprocess`, `editdisplay` | Main engine (`scripts.ts:527-555, :653, :730`): skip an empty `in`; apply the three `out` rewrites; then `data.replace(reg, out)`. With an `@@` `out` or any action, `reg.test(data)` runs first on the same RegExp (`:562-563`). This matters only for the sticky flag `y`. |
| `edittrans` | Translator (`translator.ts:797, :846-891`): skip a falsy `in`; only `$n` is rewritten; `text.replace(reg, out)`. A result line names the translation engine. |
| `disabled` or an unknown stage | Not run: the section says the entry never runs in its current stage, and that picking a stage makes it testable (MC-3999). |

**Directive entry.** This is defined by the runtime branches.
- **Main engine:** an `out` that starts with `@@emo ` (with its space), `@@move_top` or `@@move_bottom`, `@@inject` or `@@repeat_back`, or an entry carrying a `move_top`, `move_bottom`, `inject` or `repeat_back` action (`scripts.ts:564, :587, :611-612, :657`).
- **Translator:** the `move_top` or `move_bottom` action (`translator.ts:854-888`).
- An `out` starting with any other `@@` (for example `@@foo`, or `@@emo` without the space) is a **plain** entry: the runtime replaces with the literal `out` (`scripts.ts:653`).

**Not run, each stated in one line** (MC-3992):
- CBS: the `cbs` action on `in`, and the main engine's post-replace parse;
- directive entries;
- other entries, other owners and order.

**Output.**
- The match count and the first spans.
- For a plain entry, the replaced text as well.
- For a directive entry, the matches and the "directive not run" line, with no replaced text: directives are listed as not run (MC-3992).

Try it never writes to a chat, a store, the emotion state or the database.

### 6.3 Import and export (MC-3996, stage S6e)

**Hosts.** The list toolbar of the character, module and preset hosts (every preset, MC-3993). Import is guarded twice.
- **Before the picker opens,** the owner must be editable. Each of these shows the existing refusal, and no picker opens:
  - a private character;
  - a stub or shared-id module;
  - a group;
  - a gone preset;
  - a list that is not JSON-safe (M-c).
- **After the file is read,** the owner is resolved again at write time. Each of these writes nothing and shows the existing refusal text:
  - the selection moved, or the owner went away;
  - the owner's history is still loading (`ownerHistory.svelte.ts:1074-1076`). The parsed file is dropped.

**Export.** `exportRegex(list)` is reused unchanged (`scripts.ts:37-49`), with the live list read at the tap:
- character: `customscript`;
- module: `regex ?? []`;
- active preset: `db.presetRegex`;
- inactive preset: the slot's `regex ?? []`.

Every element is exported as stored, unreadable ones included. The save path is the one in §0. Success shows the existing notice. Export writes nothing persisted, makes no step, and is disabled for an empty list (D6).

**Import: read.** `selectSingleFile(['json'])`. A cancel writes and says nothing. Studio does **not** call `importRegex`, which pushes values unchecked and shows modal alerts. Instead, a new pure parser returns either the entries or the reasons. Classic import is unchanged.

**Import: shape rule** (MC-175, MC-223, MC-3997):
- **File level.** Each of these refuses the file with `studioRegexImportNotRegex`, and nothing is written:
  - the bytes are not UTF-8 JSON;
  - the top level is not an object with `type === 'regex'`;
  - `data` is not an array.
- **Empty.** An empty `data` array writes nothing and shows `studioRegexImportEmpty`.
- **Entry level.** Every element must be a well-formed entry (§2). Accepted entries are written exactly as read: unknown keys and unknown stages are kept, and nothing is normalised.
- **Any failing element refuses the whole file (MC-3997).** `studioRegexImportBadEntry(n, first)` names how many failed, plus the first failure's position and reason.
- Duplicates are not detected (D6).

**Import: write.** One step appends every entry in file order, as `objInsert`s with counts (§4):
- character: one `writeLiveCharacter` call (`CharConfigPanel.svelte:834-836`);
- module: one slot replacement;
- preset: one fresh array.

The toast `studioRegexImported(n)` follows. Undo and redo are all or nothing by `planObjStep`. An undo after an outside change that moved or changed an imported row writes nothing (`precondition`).

**Size (MC-3998).** There is no cap. S6e's Gate 1 measures a large import (T40). If the measurement shows a problem, a cap goes back to the maintainer as a new question.

## 7. Required tests

Classes:
- **RR, regression reproducer:** fails on the named pre-fix base for the intended defect, by an assertion. An import, setup or missing-export failure does not count.
- **CG, compatibility guard:** may pass before and after, and says so.
- **NB, new-behaviour test:** the base has no such function. Its red is shown by the mutants in §7.2.

RRs stay **DESIGNED, NOT DEMONSTRATED** until their pre-fix run is recorded. The seam's own properties are S7 §9's tests (T5-T12, T43-T45, T48, T50-T52) plus R1-R9 (S7 T53-T58). Draft 4's T9, T10, T12, T13, T16, T16b, T33 and T37 are superseded by those tests and by T38 and T41.

**Fixtures** are built like the real producer (MC-329):
- entries made by the Studio service;
- classic shapes as `RegexList.svelte:104-109` and `RegexData.svelte:163-167` write them;
- upstream entries with an unknown key;
- **malformed live lists built through the real `importRegex`**, with `selectSingleFile` mocked to return the file bytes;
- import files made by the real `exportRegex`, with `downloadFile` mocked to capture the bytes;
- preset fixtures through `edit/tests/presetFixture.test-helpers.ts`;
- a real `$state` root and the real write hook for the mark tests;
- **history records saved through the real store and read back by `readOwner`** (`studioHistoryStore.ts:475`) for every reload row.

| Id | Scenario | Class | Pre-fix base and expected failure | Fixture | Stage |
|---|---|---|---|---|---|
| T1 | A live character's regex item shows an editable form (name, find, replace, stage) instead of the read-only note. | RR (the edit path DD-094 and MC-3902 require) | 71882fe16: the read-only detail renders (`studio-detail-readonly`, `StudioDetail.svelte:258-259`), so the find-input assertion fails. DESIGNED, NOT DEMONSTRATED. | 3 classic entries, jsdom | S6a |
| T2 | A field edit keeps every other key, unknown ones included. | NB | n/a | entry with `x_future: {a:1}` | S6a |
| T3 | Opening, focusing and blurring write nothing. | NB | n/a | classic add shape | S6a |
| T4 | Custom flag on writes `true`, and `'g'` only when `flag` is absent or empty. Off writes `false` and keeps `flag`. Undo deletes a key that was absent. | NB | n/a | `flag` absent, `''`, `'gi<cbs>'` | S6a |
| T5 | `type: 'edit_future'` shows "Other: edit_future", and nothing is written until a pick. "Disabled" writes only `type`. | NB | n/a | upstream entry | S6a |
| T6 | Flag chips: `'<cbs>s'` minus `s` gives `'<cbs>'`; `'<order 3, cbs>g'` minus `cbs` gives `'<order 3>g'`; order 5 gives `'<order 5>g'`; order -2 gives `'<order -2>g'`; `<foo>` is kept. | NB | n/a | those strings | S6a |
| T7 | Add appends exactly the E4 entry; undo removes it; redo re-adds it. | NB | n/a | character, module | S6b |
| T8 | Move (4 kinds) and undo. Duplicate inserts a deep-equal copy after the original. Editing the copy leaves the original unchanged. Undo of the duplicate, then of an edit of the original, both apply. | NB | n/a | 5 entries, one with an unknown key | S6b |
| T11 | Delete, 3 edits, then restore from the deleted list: the entry returns at its index (clamped), deep-equal. For a **module** owner in `ready`, the record is saved and reloaded through `readOwner` between the delete and the restore, and the history and the deleted item survive. Same for a character. Preset until the page closes. | NB | n/a | unknown key; real store | S6b |
| T14a/b/c | Composed `.bin` round trip (`SaveLocalBackup`, `LoadLocalBackup`) of lists that were (a) edited, (b) added to, deleted from, moved and duplicated, (c) imported into through the service. They come back deep-equal, with unknown keys and unreadable elements. | CG (classic data passes before and after; the property is that Studio output stays upstream-shaped) | n/a | harness like `drive/tests/presetMetaBinRoundTrip.svelte.test.ts` | a: S6a, b: S6b, c: S6e |
| T15 | Module: a write is refused for a stub, a shared id, or a module that is not open. A landed write makes a new module object and array, leaves the old object unchanged, and notifies the ack. | NB | n/a | 2 modules sharing an id, a stub | S6a |
| T17 | Preset: an active edit changes only `db.presetRegex`; an inactive edit changes only its slot; both survive switching away and back. The session holder row is accepted (R6). | NB | n/a | presetFixture | S6c |
| T18 | An active preset edit assigns a fresh array; the shared slot is unchanged until `saveCurrentPreset`. | NB | n/a | slot sharing the array, as `setPreset` leaves it | S6c |
| T19 | Preset writes count marks through the real hook; a refused write marks nothing. | NB | n/a | as `presetWriteMark.svelte.test.ts` | S6c |
| T20 | `effectiveRegexFlag` returns the base runtime's answers, **taken from 71882fe16** by driving `processScriptFull` and `applyEdittransRegex`. Each row names its observable: `''`→`g` (every match replaced); `'xyz'`→`y` (only a match at the sticky position); `'gg'`→`g`; `'v'` (a `v`-only set expression compiles and matches); `'<cbs>'`→`g` (`{{char}}` in `in` matches the character name); `'<order 2>'`→`g`, order 2 (two chained entries run in order-sorted sequence); `'<move_bottom>u'`→`u` (the first match only, moved to the end); `'gi<cbs>'`→`gi` (case-insensitive, global); `ableFlag` off with `'i'`→`g` (a differently cased match is not replaced); `'<order 2, cbs>'`→`g`, order 2, `[cbs]`. `processScriptFull` output on a fixed script set is identical before and after the switch. | CG (passes before and after by design) | n/a | literal table | S6d |
| T21 | An invalid pattern shows the error from the effective flags and **is written**. `'<move_bottom>u'` with a valid `in` shows **no** error (the raw flag `mvu` would throw). Empty `in` and a CBS-first `in` show notes. | NB | n/a | entries | S6d |
| T22 | Try it, for the edit stages, uses a CBS-free sample and `out` (no `{{`), because `processScriptFull` parses CBS before and after the scripts (`scripts.ts:466, :653, :730`). Its output equals `processScriptFull` on the entry alone. For `edittrans`, `out = "<b>{{data}}</b>"` gives `applyEdittransRegex`'s output. Sticky `y` with an action: test before replace. A directive entry (each §6.2 branch) shows matches, "directive not run" and no replaced text. `@@foo` is a plain entry. No write to chats, the emotion store or the database. A disabled or unknown stage is not run, and the section says why (MC-3999). | NB | n/a | entries, a spy on the write hook | S6d |
| T23 | With 300 entries, only the visible rows mount; the menu and keyboard reach every row. | NB | n/a | 300 entries | S6b |
| T24 | History shows regex lines with the name or count; the deleted list previews the name, or "Unreadable entry". | NB | n/a | jsdom | S6a, S6b |
| T25 | Locale parity for every new key. | CG | n/a | `localeParity` | each |
| T26 | An `exportRegex` file imports into another owner deep-equal (unknown keys, unknown stages), appended in file order. | CG for the upstream file shape | n/a | real-producer bytes | S6e |
| T27 | File-level refusals (not JSON, `type` not `'regex'`, `data` not an array) give a notice and no write, step or mark. An empty `data` shows the empty notice. | NB | n/a | byte fixtures | S6e |
| T28 | A file with 2 good and 2 bad entries (`null` at 2, `in: 123` at 4) is refused whole (MC-3997). The notice reads "2", with the position-2 "not an object" reason, localised. | NB | n/a | that file | S6e |
| T29 | Import is one step. Undo removes exactly the imported entries; after an outside edit of a non-imported row, undo still applies. After an outside move of an imported row, undo writes nothing (`precondition`). Redo re-adds. | NB | n/a | 3-entry file | S6e |
| T30 | Import guards: no picker for a private character, a stub or shared-id module, or a list that is not JSON-safe. An owner gone or deselected while the picker is open, or history still `loading` when it resolves, gets the existing refusal and no write. | NB | n/a | delayed picker mock | S6e |
| T31 | Import into the active preset assigns a fresh `db.presetRegex`; into an inactive preset, a fresh slot array. Marks as T19. | NB | n/a | presetFixture | S6e |
| T32 | Export passes the live copy: the active preset's working list, not its lagging slot; an inactive slot; a module's `regex ?? []`. A `false` from `downloadFile` shows nothing. | NB | n/a | a preset whose copy and slot differ | S6e |
| T34 | Restore to when Studio opened (MC-4051), cases (a)-(i) and (h') listed below the table. | NB | n/a | 3 entries; 300 × 20 KB for (f); one 25 KB entry for (g), (h), (h') | S6a, (d) S6b |
| T35 | Malformed elements, built through the real `importRegex`. M-a objects (`{comment:'x', in: 123, out:'', type:'editinput'}`, an object without `comment`) show as unreadable: edit and duplicate are refused, Try it is not offered, delete and move land, the record parses after save and reload (character and module), and undo restores the element exactly. M-b elements (`null`, `"text"`) are inert rows with no action. | NB | n/a | classic-import fixture | S6a (rows, refusals), S6b (delete, move) |
| T36 | A list holding a value that is not JSON-safe is read-only as a whole: no op, no journal entry, no import, and the classic link is shown. Values tried: `NaN`, an `undefined` element, `flag: undefined`, a nested `{x: {y: undefined}}`, injected in memory. | NB | n/a | in-memory list | S6a |
| T38 | **Regex holder rows.** Character and module records hold each regex shape: `objSet` for every field (`{had:false}` on `flag` and `ableFlag`), `objInsert`/`objRemove` with `content` counts, the obj deleted item, and every label action. Each is saved through the real store and parses after `readOwner`. A record with `ownerKey` rewritten to a `chat:` key, one shape per record, is refused by `parseOwnerRecord` called directly (R3; review 3 E-g). An `objSet` on a field outside the regex table is refused. Scratch evidence for Gate 2, as S7 T6: 71882fe16's `parseOwnerRecord` returns null for each shape. | NB (the scratch part is diagnostic) | n/a | records written by the service | S6a, extended in S6b and S6e |
| T39 | **Realistic size.** A 300 × 20 KB list on a character and on a module gets one field edit and one delete, then a save and `readOwner`. The deleted item and both steps are present, and the stored restore point holds no list. The S6b part also records the plan time of Add, Move, Duplicate and the undo of a Delete on that list (`content` counts over every row). | NB (the timings are measurements for Gate 2) | n/a | synthetic 300 × 20 KB | field part S6a, delete part S6b |
| T40 | **A step larger than the owner share.** A 300 × 20 KB import pins what the walk stores (the restore point and deleted items; no `done` step while the import is newest) and that the trimmed banner shows. This is the MC-3998 measurement: record size, save time, the import's plan time and the import undo's plan time. | CG (pins today's walk; it changes with #716 (MC-4052) and says so) | n/a | synthetic file | S6e |
| T41 | **Totality (R1).** In a list `[entry, null, "x", entry]`, delete index 0, move the last entry to the top, edit it, duplicate it and import 2 entries. All plan and apply, while `null` and `"x"` stay byte-equal and offer no action. | NB | n/a | classic-import fixture | S6b |
| T42 | **Mixed revert (R5).** A revert range holding an asset-merge `textEdit regex/<i>/out` step and a regex obj step is refused and writes nothing. | NB | n/a | asset merge fixture | S6b |

T34 cases:
- (a) A regex-only visit stores an empty-fields point, shows only the regex line, and reverts it.
- (b) A visit with a field edit and a regex edit shows both, and Confirm restores both.
- (c) After a reload, the earlier visit's point shows its field rows and `studioRegexRestoreEarlierVisit`, with no regex line. The deleted item and steps remain.
- (d) An outside change makes the line revert nothing, with `studioRegexRestoreChanged`; the field writes proceed.
- (e) The stored record never holds a regex list in `restore`.
- (f) On a 300 × 20 KB list, a field edit computes the anchor of the edited entry only (a spy on the anchor function).
- (g) 500 coalesced keystrokes into one `out` of a 25 KB entry leave exactly one journal entry, and choosing the line restores the visit-start bytes. The value of the line's `n` is #685's (R9) and is not asserted here.
- (h) 500 writes into one `out`, each more than `COALESCE_MS` apart (500 steps), with one undo and redo among them, still leave one journal entry.
- (h') Three writes to one `out`, each more than `COALESCE_MS` apart: undoing three times restores each intermediate value, and after a save and `readOwner` the record's three steps each keep their own `before` and `after`.
- (i) On a character whose lorebook journal also holds an entry, an outside change refuses the regex line only: the lorebook line still applies. Runs against the service, not the sheet: a lore `objSet` through S7-0's writer, and each list's line chosen through the service, so it needs S7-0 only (the sheet's lorebook line is S7-1).

### 7.2 Mutants that must be killed

Draft 4's M11-M13, M22, M32, M36-M38, M40 and M42 tested S6's own seam. They are superseded by S7 §9.1 and by M43-M47.

| Mutant | Breaks | Must fail |
|---|---|---|
| M1 a field write keeps only known keys | E1 | T2 |
| M2 viewing writes the normalised entry | E3 | T3 |
| M3 `had:false` assigns `undefined` | E2 | T4 |
| M4 custom flag on always writes `flag: 'g'` | `ableFlag` rule | T4 |
| M5 the select writes its first option for an unknown stage | E5 | T5 |
| M6 the letter toggle uses `flag.replace(letter, '')` | E6 | T6 |
| M7 the action toggle removes the whole group | E6 | T6 |
| M8 add omits `type` or adds `flag` | E4 | T7 |
| M9 move inserts in pre-removal coordinates | move | T8 |
| M10 duplicate inserts the same object | duplicate | T8 |
| M14 restore of a deleted entry appends at the end | §4 | T11 |
| M15 the parser accepts regex shapes on a chat record | R3 | T38 |
| M16 a module write mutates `module.regex` in place | E7 | T15 |
| M17 a preset write always targets the slot | F4 | T17 |
| M18 a preset write mutates `db.presetRegex` in place | E7 | T18 |
| M19 effective flags ignore `ableFlag` | §6.1 | T20, T22 |
| M20 validation compiles with the raw `flag` | §6.1 | T21 |
| M21 an invalid pattern is not written | MC-3991 | T21 |
| M23 import prepends | §6.3 | T26 |
| M24 import rebuilds entries from known keys | §6.3, E1 | T26 |
| M25 import accepts `data` that is an object | §6.3 | T27 |
| M26 import writes one step per entry | §6.3 | T29 |
| M27 import uses the owner captured before the picker | §6.3 | T30 |
| M28 import into the active preset writes the slot | F4 | T31 |
| M29 export reads the active preset's slot | §6.3 | T32 |
| M30 the extraction drops the group strip (`flag \|\| 'g'` first) | §6.1 | T20 |
| M31 Try it uses the main-engine rules for `edittrans` | §6.2 | T22 |
| M33 a field edit is allowed on a malformed entry | M-d | T35 |
| M34 import accepts a file with one bad entry | MC-3997 | T28 |
| M35 an op or journal entry is made for a non-JSON-safe list | M-c | T36 |
| M39 the JSON-safe check is shallow | M-c | T36 |
| M41 Try it shows replaced text for a directive entry, or treats `@@foo` as a directive | §6.2 | T22 |
| M43 a regex list is written into the stored restore point | MC-4051 | T34 (e), T39 |
| M44 an op is offered on an M-b element | §2.1 | T35, T41 |
| M45 an `objSet` on a field outside the regex table is accepted | §5.1 | T38 |
| M46 the anchor or counts read a non-object element as an object (throws) | R1 | T41 |
| M47 a revert range mixing `regex/` text and regex obj ops is planned | R5 | T42 |
| M48 the journal appends one entry per keystroke | J3, R9 | T34 (g) |
| M49 the journal merges only within one coalesced step (per-step merge) | J3, R9 | T34 (h) |
| M50 the regex and lorebook lines plan jointly, so one refusal stops both | J5, R4 | T34 (i) |
| M51 the tail-merge updates the tail op in place | R9 | T34 (h') |

## 8. Build stages and gates

Each stage is one PR, Tier 2 (MC-2746), with its own Gate 1 plan from this spec. Sizes are ESTIMATES, tests included. **S6a builds on S7-0 as merged with R1-R9.** S6a's Gate 1 build plan starts after S7-0 (S7 §10) merges, checks R1-R9 against the merged code, and carries any that is missing, serialized with S7.

| Stage | Content | Files / lines | Gate 2 |
|---|---|---|---|
| **S6a** regex rows and field edits | The §5.1 rows; the generalised edit intent for character and module (today an edit build gets a character `LiveTarget` only, `ownerHistory.svelte.ts:377-378`); field writers; the item editor; unreadable rows and read-only lists (§2.1); the regex restore line; history lines; keys. Tests T1-T6, T14a, T15, T24-T25, T34 (a-c, e-i, h'), T35-T36 (edit parts), T38, T39 (field part). Mutants M1-M7, M15-M16, M33, M35, M39, M43, M45, M48-M51. MC-3998 measurement for field steps (T39). | 12-16 files, 1,500-2,300 lines | **opus-reviewer** |
| **S6b** list operations | Add, delete (toast, focus), restore deleted, move, duplicate, the windowed list view, the heading help. Tests T7-T8, T11, T14b, T23, T34 (d), T35 (list parts), T39 (delete part), T41-T42. Mutants M8-M10, M14, M44, M46-M47. Measurement for list ops and deleted items, with their plan times (T39). | 6-10 files, 900-1,500 lines | **opus-reviewer** |
| **S6c** preset host | Reuses #703's selection, id mapping and gone flow. The session spec names the list (R6); the adapter reads and writes per live copy, copy-on-write, for every preset; the inactive note; no chip. Tests T17-T19. Mutants M17-M18. | 5-8 files, 600-1,200 lines | **opus-reviewer** |
| **S6d** validation and Try it | `effectiveRegexFlag`, characterisation first; the problems line and the row marker; Try it with the per-stage engines. `streamSpans.ts` is not touched (K9). Tests T20-T22. Mutants M19-M21, M30-M31, M41. | 5-8 files, 700-1,200 lines | Sonnet reviewer if the extraction is a pure move proven by T20; otherwise **opus-reviewer** |
| **S6e** import and export | The pure parser and the shape rule; the toolbar on three hosts; the guards; export through `exportRegex`; keys. Tests T14c, T26-T32, T38 (import label), T40. Mutants M23-M29, M34. Includes the MC-3998 import measurement (T40). | 5-8 files, 700-1,200 lines | **opus-reviewer** |

**Order.** S7-0, then S6a, then S6b. S6c comes after S6b, S6d any time after S6a, and S6e after S6b (and after S6c for the preset toolbar).

**Serialization.** S6a, S6b and S6e edit `ownerHistory.svelte.ts`, `studioSetters.ts`, the history panel and sheet, and `StudioDetail.svelte`. They serialize with each other and with S7-1. S2 (#680) also edits `StudioDetail.svelte`.

Each PR carries all 8 locales for its keys (MC-058).

## 9. Product decisions

### 9.1 Settled (maintainer, AskUserQuestion; `Agents/mc/684.md`; MC-4030 and MC-4043 in `Agents/mc/682.md`)

| Id | Decision | Effect |
|---|---|---|
| MC-3990 | "Disabled" stays a stage; no enabled switch | §2, §3 |
| MC-3991 | An invalid pattern warns and is written | §6.1, T21, M21 |
| MC-3992 | Per-entry "Try it" with the runtime flag rules, no CBS, directives listed as not run | §6.2, T22 |
| MC-3993 | Every preset is editable; an inactive one says it is not in this chat | §1, §3, T17, T31 |
| MC-3994 | No preset save chip until #666 | §3 |
| MC-3995 | Duplicate, keeping the same name | §4, T8, M10 |
| MC-3996 | Import and export in Studio as S6e: import appends as one undo step, export reuses `exportRegex` | §6.3, T26-T32 |
| MC-3997 | An import with any malformed entry is refused whole; the notice names how many failed and the first reason | §6.3, T28, M34 |
| MC-3998 | No import cap; measure; a cap returns as a new question if needed | §5.5, §8, T39, T40 |
| MC-3999 | Try it does not run an entry whose stage never runs; it says so | §6.2, T22 |
| MC-4030 | Studio replaces classic, so it must be feature complete; a link out is interim only, with a follow-up | §1.1 |
| MC-4043 | App-wide settings beside a form stay in Settings; per-item fields must be in Studio | §1.1 |
| MC-4050 | The three link-outs (unreadable entry, non-JSON-safe list, shared-id module) are interim; follow-ups #713, #714 | §1.1, §2.1 |
| MC-4051 | Restore-to-open covers an entry list for this session only; no whole list in the stored restore point; after a reload, steps and deleted items remain | §4, §5.3, T34, M43 |
| MC-4052 | The store keep walk is verified and filed separately as #716, not fixed in #684 | §4, §5.5, K10 |

### 9.2 Open

None. R1-R9 (§5.7) were requests to #685, answered in S7 r6; they are not product questions.

## 10. Design defaults to confirm (Gate 1, not product questions)

- **D1:** `in` is a compact long-text field in plain mode.
- **D2:** drag to reorder on wide layouts only; phones use the row menu.
- **D3:** unknown flag tokens are shown read-only as "Also kept".
- **D4:** after a name, stage or replace edit, at any stage, the chat refreshes with one `ReloadGUIPointer` bump when the step closes. This is classic parity (`RegexData.svelte:114-120, :131-133`); the build checks whether the chat re-renders without it.
- **D5:** the order note and the order chip show only for entries with `ableFlag` on and an `order` meta.
- **D6:** export is disabled for an empty list; import does no duplicate detection; the import toast has no Undo button.
- **D7:** an M-a element offers Delete and Move only; an M-b element is inert (§2.1).
- **D8:** a list that is not JSON-safe, by the deep rule, is read-only as a whole, with the classic link (§2.1 M-c).
- **D10:** the list heading carries classic's `regexScript` help (§1.1).

## 11. Risks and known limits

- **K1** Old asset-merge steps address `regex/<i>/out` by index. After a move, duplicate or import, an undo of such a step can meet another entry, but only where the same reference name is still scanned at the same offset (`historyModel.ts:991-1009`; accepted limit L1). A revert that mixes them with regex obj ops is refused (R5).
- **K2** History stores whole entries, so records grow. §5.5 lists every channel. Measurements run where each payload first lands: S6a field steps, S6b list ops and deleted items, S6e import (T39, T40).
- **K3** A classic edit of the same entry makes a later Studio undo refuse with `precondition` (anchor). Header Undo stops at that step, and History's single-step undo goes past it (S7 §11).
- **K4** Group regex stays in the classic editor until S8.
- **K5** The flag extraction touches the runtime. T20 pins it before the switch.
- **K6** The merged view numbers `edittrans` entries as preset, character, modules (`ts/studio/mergedView.ts:35-41`), but they run as preset, modules, character (`translator.ts:788`). This is pre-existing; follow-up.
- **K7** Classic import is unchecked and Studio import is strict (MC-3997), so a file classic accepts may be refused by Studio.
- **K8** Export is lossless, so a list holding unreadable elements exports a file Studio's own import refuses (MC-3997).
- **K9** The streaming probes' `deriveScriptFlags` (`chatShell/streamSpans.ts:129-145`) gives `u` for `<cbs>` and `<order 2>` where both engines give `g`, and `streamSpans.test.ts:147` pins it. This is pre-existing; follow-up.
- **K10** **Store keep-walk ticket #716 (MC-4052).** The walk stops at the first entry that does not fit. A single step or deleted item larger than the owner share (a large import, a restore-line step) therefore drops it and every older entry. Deleted items are walked before steps, so many large deletes crowd out steps. Store-wide eviction removes whole owners. T40 pins today's behaviour.
- **K11** An insert has no anchor, so an undone delete can land at a shifted index. It never overwrites (S7 §11).
- **K12** S6a builds on S7-0 as merged with R1-R9 (§8). A request missing from the merged code moves into S6a's diff and its opus Gate 2.
- **K13** A deleted regex entry cannot be restored from History while more identical twins are live than when it was deleted (S7 I2): for example, duplicate X, delete the original, then duplicate X again. The refusal shows `studioRegexRestoreTaken`; no data is lost, because the identical content stays live.

## 12. Premises

**REOPENED** (primary source read for this draft or for draft 4):
- **Entries and runtime:** the entry shape and hosts; both engines, including the flag pipeline order, rewrites, directive branches (`scripts.ts:562-664`), negative orders (`:747`; `RegexData.svelte:48-63`), the invalid-pattern skip and the cache key; the streaming copy.
- **Classic UI and mounts:** `RegexData.svelte:31-172`, `RegexList.svelte:23-120`, `CharConfigPanel.svelte:246-249, :307, :423-427, :800-842`, `ModuleMenu.svelte:196-206, :238, :307-320`, `BotSettings.svelte:814-816`; the MCP regex writers.
- **History:**
  - `historyModel.ts` constants `:18-21`;
  - the restore model `:200-211, :1214-1269, :2315-2422, :2528-2564`;
  - `commitStep` `:2661-2710`;
  - the kind gates `:528, :543-609, :639-645`;
  - `listFingerprint.ts`;
  - `studioHistoryStore.ts:16-25, :613-688` (the keep walk).
- **S7 spec r6 (merged, `b280831a4`):** §4 (whole, with §4.1a), §7, §9 and §9.1, §10, §11 and §18, read in `docs/design/studio/S7_LORE_SPEC.md`. The fit is recorded in the #684 note `seam-fit.md`.
- **Decisions:** `Agents/mc/684.md` MC-3990..3999 and MC-4050..4052.

**INHERITED:**
- **From review 4 / `advisor-2.md`:** every non-composing `input` event commits one write (`longText/fieldWrite.ts:84, :95-106`); the journal-retention model (`%TEMP%\risu-684\r4-scratch\journal-mem2.mjs`, 48.8 MB after 1,000 keystrokes into a 25,000-character two-byte field).
- **From review 3 / `advisor-1.md`:** the store eviction lines (`studioHistoryStore.ts:781-806`); the protocol lines (`studioStoreProtocol.ts:106-159`); MC-1119 answer 6 and MC-1812 wording (`Maintainer-Context.md:22760, :29029`); `scripts.ts:466`.
- **From S7 r6 (stated in S7 §4.6, not re-read in source here):** `visitId` per `openStudio`; the restore panel and sheet lines; the zero-write early return. r6 §4.6 still states all three (the lines now per list; the point creation rule and visibility table).
- **From the brief:** the MC-4030 and MC-4043 text (`Agents/mc/682.md` on another branch).
- **From sizing (`651-sizing.md`):** the key counts.

### S7-0 dependency check (r6, merged b280831a4)

All "S7 §n" cites in this spec were checked against `S7_LORE_SPEC.md` revision 6 on 2026-11-23 (the spec text, not S7's code, which is not built). Every cited section exists in r6 and says what the S6 sentence relies on; no section number moved. Cites changed:
- §5 intro: "All of them are S7 §4." was malformed and now reads "All of them are S7's (§4)."; no section changed.
- Elsewhere only status wording changed (R1-R9 answered in S7 r6 in the header, §1, §5 intro, §5.7, §7 and §9.2, with S7 test and mutant ids added); no cite changed.
