# Studio S7: lorebook editing (spec)

Ticket #685 (Studio stage S7, MC-3900). Spec only (MC-3902): the build is a later PR on the same ticket and starts after this spec merges. Written 2026-11-23 against `71882fe16` (worktree `685-lore-spec-652b5e`).

- Revision 2 applied MC-4004 to MC-4008.
- Revision 3 answered Gate 1 review 1 (section 15) and applied MC-4009, MC-4030 and MC-4043.
- Revision 4 answers review 2 (section 16). It replaces the replay mechanism: obj steps get their own all-or-nothing planner (4.2), deleted items follow one tag rule (4.4), and the restore line reverts an in-memory visit journal (4.6).
- Revision 5 answers review 3 under the senior advisor's direction (section 17). The r4 mechanism is frozen. Replay identity is closed as a class: invariants and a closure table (4.0), a count per identity on every row (4.1), identity changes only by remove and insert, `already` by witness (4.2). The restore point's creation rule returns with a visibility table (4.6), and a generated-history property test is added (T50).
- Revision 6 applies review 4's editorial findings, MC-4080 (D1 to D8 confirmed; drag-and-drop reorder is #718) and #684's seam requests R1 to R9: per-list tables (4.1a) and a journal tail-merge with a stated memory bound (4.6). Section 18 answers each. MC-4081 settles the non-entry row (#720).
- Gate 1: rounds 1 to 3 rejected; round 4 (revision 5) and round 5 (revision 6, delta) passed as [EDITORIAL], and round 5's four editorial findings are applied in this text.

Notation: a folder key is the single character U+F000 followed by `folder:` and a v4 UUID. Source writes the character as the JavaScript escape backslash-u-f000 (`lorebook.svelte.ts:147`); this spec spells it "U+F000" so that no viewer drops it.

## 0. Status and decisions obeyed

| ID | What it settles here |
|---|---|
| DD-094 | Studio hosts every authoring form; Studio becomes the lorebook editor. |
| MC-4030 (`Agents/mc/682.md`, PR pending) | Studio replaces classic, so every classic lorebook field and operation exists in Studio. A link-out to classic is allowed only as an interim step with a follow-up ticket. Parity audit: 1.2. |
| MC-4043 (`Agents/mc/682.md`, PR pending) | The one exception to MC-4030: an app-wide setting that classic shows next to a form's fields stays in Settings and is not a parity gap. Per-item fields must still be in Studio. Here: `bulkEnabling`, `useExperimental`, `localActivationInGlobalLorebook`, `loreBookDepth`, `loreBookToken`. Studio keeps each gate they drive and never writes them (1.2, 3.5). The per-owner lorebook settings (`loreSettings`, `loreExt`, `lorePlus`) stay in Studio (MC-4003). |
| DD-095 | Live save with status chip, owner undo and a restore point; lorebooks take no snapshot (MC-4008, 4.6). |
| DD-100, SLICE1 §5 | SLICE1 §5 applies DD-100's rule to every live item: a delete never asks first, and its undo is durable. This covers single entries; a folder subtree follows MC-4009. |
| DD-102 | Changed elsewhere: Studio never silently undoes another change. |
| MC-4000 | Full field parity with `LoreBookData.svelte` (3.3). Name, keys and content shown; rarer fields in a collapsed section. |
| MC-4001 | Full folder operations, plus adding, deleting and reordering entries, all upstream-shaped (MC-175). |
| MC-4002 | Three hosts: `character.globalLore`, `chat.localLore`, `module.lorebook`, each through its own write path. |
| MC-4003 | Per-owner lorebook settings, import and export, and decorator help, all in Studio. |
| MC-4004 | Import gives fresh ids and keys only to colliding entries and folder keys, with a notice (3.6). |
| MC-4005 | Entries sharing an id within one lorebook are marked and offered "Give this entry a new ID" (3.3). |
| MC-4006 | Probability: the legacy `activationPercent` field shows while it holds a number, and a Probability control reads and writes the `@@probability` line (3.3a). |
| MC-4007 | A reply's deep link opens an entry by id even if it moved or was renamed (6). Amends MC-3334 for entries with an id. |
| MC-4008 | No restore-point snapshot for lorebooks; "Back to when Studio opened" reverts this visit's lorebook changes (4.6). |
| MC-4009 | (1) Deleting a non-empty folder asks once, with the count of entries that go with it; an empty folder deletes without asking; one undoable step (3.4). (2) An imported entry with no id gets a fresh id (2.3, 3.6). |
| MC-4080 | D1 to D8 are confirmed defaults (12). D3: S7 reorders by row menu and Alt+↑/↓; drag-and-drop reorder in the windowed list is follow-up #718. |
| #684 (S6 regex) | S6 reuses this spec's section 4 as the single shared object-list seam; its requests R1 to R9 are part of section 4 (4.1a, 4.6, 18). |
| MC-989 | Module lorebooks follow the character's boundary option: no module settings field. |
| MC-3334 | A reply's lore list opens Studio on the entry; entries without an id keep its position-and-name rule; a deleted entry opens the owner's list. |
| MC-3399 | Decided the windowing of Studio's merged list and noted a future new-UI lorebook list would be new work. S7's list (3.2) applies the same windower; that is this spec's design, not that decision's. |
| MC-175, MC-223, MC-774 | Upstream `.bin` round trip: Studio writes only fields upstream's `loreBook` has and keeps unknown fields. |
| MC-350, MC-1827 | History format: a widening that older builds refuse whole keeps v2 (7). |
| MC-623/627/629/1233 | Module lorebook repair question: Studio does not edit a module lorebook that is not a list (5.3). |
| MC-3901 | S8 adds the group owner kind; group lorebooks reuse this editor (1.1). |
| MC-058 | New `en.ts` keys ship with all 7 locales in the build PR. |
| chromemory-spec §5.4 | Identity is the `id`, else a content hash; entries sharing an identity are skipped. Child-mode entries are ineligible for recall (`chromemory-spec.md:363`). The editor keeps ids stable (2.3). |

No product question is open. MC-4080 confirmed design defaults D1 to D8 (12); D7 is the coordinator's classification of N3's fix, and D8 is where MC-4008's "cannot be reverted" lands (4.6). O1 and O2 are for #687. MC-4081 settles how the lorebook list shows a live element that is not an object: an inert marked row with no ops, data untouched, repair in follow-up #720 (18, Q1).

## 1. Scope

In scope:
- A windowed lorebook list for each host, folders nested.
- An entry form with every classic field, a folder form, and a linked-entry view for chat child links.
- List operations: add entry, add folder, duplicate; delete one entry or a folder subtree; reorder and move into and out of folders; rename folder; always active per entry, per folder and in bulk (`bulkEnabling`); give an entry a new id (MC-4005); local activation of a character entry in the current chat (`localActivationInGlobalLorebook`).
- The probability pair (MC-4006, 3.3a).
- The character's lorebook settings and LorePlus (3.5).
- Import of one or more files and export, for each host; decorator autocomplete and warnings.
- The deep link by entry id, with the module index fix (6).
- A generic object-list history op family with its own planner (`obj*`, `planObjStep`): the single object-list seam that S6 regex and S8 reuse, with per-list tables (4.1a).

Not in this build:
- Scan changes beyond the reported-index fix, the reported `entryId` and three extractions (import parsing, export bytes, the per-entry version migration).
- Drag-and-drop reorder: follow-up #718 (D3, MC-4080). Reorder by row menu and Alt+↑/↓ is in scope.
- Windowing the Studio tree, which keeps its paging.
- Recovering already-corrupted fork-local data (MC-011).

### 1.1 Follow-up requirement on S8: group lorebooks (MC-3901, MC-4030)

Classic lorebook features with no Studio host until S8 adds the group owner kind:
- `groupChat.globalLore`, the group lorebook (`LoreBookSetting.svelte:69`, `:83`);
- a group chat's `localLore`;
- the group's `loreSettings` (`database.svelte.ts:1669`).

Studio refuses groups today (`applyCharacterWrites`, `studioSetters.ts:496-499`). **S8's ticket must carry all three.** It reuses this editor, `planObjStep` and the `obj*`/`propSet` ops unchanged. S8 must:
- add `group` to `OBJ_LIST_HOLDERS` (`lore` → `globalLore`) and `OBJ_PROPS` (`loreSettings`);
- add a group-chat host for `localLore`;
- extend T20 to T24 to the group hosts.

Until S8 lands, groups keep the classic sidebar as an interim link-out under MC-4030; lane A records that S8's ticket carries this requirement.

### 1.2 Classic parity audit (MC-4030, MC-4043)

Paths audited: `LoreBookSetting.svelte`, `LoreBookList.svelte`, `LoreBookData.svelte`, the module lore tab of `ModuleMenu.svelte` (`:116-194`, `:232`, `:287-303`), the character sidebar's lorebook tab (`CharConfigPanel.svelte:315`, `:801-802`) and the reply list (`ShellMessage.svelte:909`).

Search: the regex `globalLore|localLore|\.lorebook\b|LoreBook\w*|loreSettings|lorePlus|loreExt` under `src/lib`, tests excluded, finds 12 files (COMPLETE for that regex). Beyond the paths above: `ReplyLoreUse.svelte` (section 6), `PromptDataItem.svelte` (the preset prompt type name), `DevTool.svelte` (runs the scan), `OtherBotSettings.svelte` (the app-wide token budget, Settings), `StudioLoreTester.svelte` (reads scan depth) and a test helper. None edits lore. A second search, for `DBState.db.` reads other than `characters` in `src/lib/SideBars/LoreBook/` and other than `modules` in `ModuleMenu.svelte`, finds the five app-wide settings below and `useAdditionalAssetsPreview` (assets tab, not lore).

| Classic feature (source) | Studio |
|---|---|
| Character / Chat / Settings tabs (`LoreBookSetting.svelte:65-81`) | Owner tree hosts (3.1); settings 3.5 |
| Info text `globalLoreInfo`, `localLoreInfo` (`:83`) | List header (3.2) |
| Group tab, `groupLoreInfo`, group chat lore, group settings | S8 requirement (1.1); interim classic |
| Add entry (`lorebook.svelte.ts:113-140`; `ModuleMenu.svelte:116-131`) | 2.5, 3.2 |
| Add folder (`lorebook.svelte.ts:142-170`; `ModuleMenu.svelte:133-149`) | 2.5, 3.2 |
| Add entry inside a folder (`LoreBookData.svelte:219-233`) | 3.4 |
| Export (`lorebook.svelte.ts:1108-1133`; `ModuleMenu.svelte:151-169`) | 3.6 |
| Import, one file (`lorebook.svelte.ts:1003-1038`) or several (`ModuleMenu.svelte:171-194`) | 3.6, several files for every host |
| Bulk always active, character and chat (`LoreBookSetting.svelte:157-178`) | 3.2 `⋯` menu, same `bulkEnabling` gate |
| Use global settings, recursive scanning, full word, ASCII boundary + `loreExt` sync, CJK word start + `loreExt` sync, scan depth, token budget (`:86-126`) | 3.5 |
| LorePlus switch, the per-character `lorePlus` (`:127-134`) | 3.5, same `useExperimental` gate; D2 |
| App-wide flag `bulkEnabling` (`:157`) | Stays in Settings (MC-4043); gate kept (3.2) |
| App-wide flag `useExperimental` (`:128`) | Stays in Settings (MC-4043); gate kept (3.5) |
| App-wide flag `localActivationInGlobalLorebook` (`LoreBookData.svelte:280`) | Stays in Settings (MC-4043); gate kept (3.3) |
| App-wide `loreBookDepth`, `loreBookToken` (seed values, `LoreBookSetting.svelte:117-121`; no control in classic) | Stays in Settings (MC-4043); same seeding, read-only line (3.5) |
| List with folders, empty text `noLorebook` (`LoreBookList.svelte`) | 3.2 |
| Drag reorder within and across folders (`LoreBookList.svelte:110-288`) | Row menu and Alt+↑/↓ reorder, Move to folder (2.6); drag-and-drop: follow-up #718 (D3, MC-4080) |
| Open and close an entry or folder | Selection (3.1, 3.9); folder expand (3.2) |
| Row always-active toggle; on a folder also the direct children (`LoreBookData.svelte:141-163`) | 3.2 |
| Delete entry (`:164-188`) | No confirm, durable undo (SLICE1 §5) |
| Delete folder with contents (two confirms, `:167-176`, `LoreBookList.svelte:339-352`) | One confirm with a count (MC-4009, 3.4) |
| Delete removes the character entry's chat links (`LoreBookData.svelte:180-182`) | Links kept (D4) |
| Child link row: parent name, `childLoreDesc`, delete (`:189-205`) | 3.4 |
| Folder name (`:209-216`) | 3.4 |
| Entry fields with Help keys, token count (`:237-300`) | 3.3 |
| Activation probability (legacy, `:254-264`) | 3.3a |
| Module lore tab (`ModuleMenu.svelte:287-303`; `lorebook ??= []` `:232`) | Module host (3.1); absent list reads empty, first insert creates it |
| Reply lore list (`ShellMessage.svelte:909`) | Section 6 |

No feature outside groups needs a link-out. The five app-wide settings are not gaps (MC-4043). The existing "Open classic editor" button (`StudioDetail.svelte:261-266`) stays as a convenience.

## 2. Data and persisted shape

### 2.1 The entry (upstream shape, unchanged)

`loreBook` (`database.svelte.ts:1440-1461`): `key`, `secondkey`, `insertorder`, `comment`, `content`, `mode` (`multiple|constant|normal|child|folder`), `alwaysActive`, `selective`, `extentions?.risu_case_sensitive`, `activationPercent?`, `loreCache?`, `useRegex?`, `bookVersion?`, `id?`, `folder?`.

Hosts: `character.globalLore` (`:1476`), `chat.localLore` (`:2010`), `RisuModule.lorebook?` (`modules.ts:48`). Settings: `character.loreSettings?` (`:1500`, type `:1635-1644`), `character.loreExt` (`:1501`), `lorePlus?` (`:1583`).

Rules every Studio write follows:
- **Unknown fields are kept.** A field edit changes one key (the `extentions` container is written whole, 4.1). A move, duplicate, import or restore carries the whole entry as a plain JSON copy, `loreCache` and unknown keys included. Each insert writes a fresh copy of the stored entry.
- **No fork-only key on an entry.** Every key Studio writes exists in upstream's `loreBook`.
- **Absent stays absent.** `{ had: false }` deletes a key; never `undefined` or `null` (`historyModel.ts:111`). A stored `activationPercent: null` (from the migration, `characters.ts:1094-1097`) stays `null`.
- **An empty-string `id` counts as no id** for the duplicate marker, identity counts (4.1), `entryId` and import (E7). The scan differs: its `id ?? pickHashRand(5555, content)` treats `id: ''` as an id (`lorebook.svelte.ts:564`, `:577`), which matters to #687 and O2.

### 2.2 Folders (upstream representation)

Classic and upstream folders (`lorebook.svelte.ts:142-170`, `ModuleMenu.svelte:133-149`): `mode: 'folder'`, `key` = U+F000 + `folder:` + uuidv4(), `comment` = name, `content: ''`, `insertorder: 100`, `alwaysActive: false`, `secondkey: ''`, `selective: false`. Studio writes this shape plus `bookVersion: 2`.

- Membership: `folder` equals the folder's `key`; top level is `folder` absent or falsy (`LoreBookList.svelte:49`, `:374`). Moving out deletes the key (`:198-204`).
- Folders nest. A folder delete removes the subtree; cycles terminate (`lorebookFolders.ts` `getLoreBookSubtree`).
- The scan has no folder logic. Folder always active sets the folder and its **direct** children (`LoreBookData.svelte:147-156`).
- An entry whose folder does not exist shows at top level with a folder-missing marker and "Move out of folder" (D5).
- Array order matters (child links look only at earlier entries, `lorebook.svelte.ts:512`). A folder's children show in array order; a folder moves as one contiguous block; Studio never re-sorts entries it did not move.

### 2.3 Entry identity (`id`)

The scan keys chat state on `id ?? hash(content)` (`lorebook.svelte.ts:564`, `:577`); a child link finds its parent by `id` (`:507-528`); ChroMemory §5.4 uses the id.

| Operation | `id` |
|---|---|
| Field edit, rename, move, reorder, folder always active | Untouched |
| Undo, redo, revert, restore of a deleted item | The exact stored entry and id; redo never generates an id |
| Add | Fresh `uuidv4()`, unique in the host list |
| Duplicate | Deep copy with a fresh id |
| Import (MC-4004, MC-4009) | No id: fresh. Free id: kept. Taken id: fresh (3.6). Folder rows without id stay without. |
| New folder | No id (identity is its `key`) |
| Existing id-less or shared id | Changed only by "Give this entry a new ID" (MC-4005) or by turning on local activation for an id-less character entry (`LoreBookData.svelte:62-65`), each its own step, built as remove + insert (4.0) |

The one way history re-creates a shared id: undoing "Give this entry a new ID" restores the state the user had.

### 2.4 `bookVersion` and the version migration

`updateLorebooks` (`characters.ts:1088-1103`) brings each entry below version 2 to version 2: a truthy `activationPercent` becomes a prepended `@@probability` line and the field `null`; `@@end`/`@@@end` become `@@depth 0`; `<char>`/`<bot>` become `{{char}}`, `<user>` becomes `{{user}}`. It edits entries in place.

**When it runs** (corrected in r4, N3):
- character `globalLore`: on every `characterFormatUpdate` (`characters.ts:1041`), which runs on every character selection (`changeChar`, `:2027`; groups `:2021`) and from `group.ts:35`, `coldMemberRestore.ts:53`, `playgroundChat.ts:65`, `homeStudio.svelte.ts:174`;
- module `lorebook`: at boot (`bootstrap.ts:709` → `repairModuleListLorebooks`) and at every stub load (`moduleLoader.ts:141`);
- chat `localLore`: never.

**Studio writes only version-2 entries into character and module lists (D7).** The build extracts the per-entry rule as `migrateLoreEntryToV2(entry)` (`updateLorebooks` maps it, unchanged behaviour). Studio applies it, inside the step, to every entry it imports or duplicates into a character or module list; add and new folder write `bookVersion: 2` directly. The bytes equal what the next selection or load would produce, so nothing rewrites them later. Chat lists keep imported entries verbatim, since nothing migrates them.

**The anchor ignores `bookVersion`** (4.1), so a migration that only stamps the version leaves Studio's steps valid.

Known limitation: a classic-created entry (no `bookVersion`) whose content holds `@@end`, `<char>`, `<bot>` or `<user>`, or whose `activationPercent` is truthy, and that Studio edits before its character is selected again (or its module reloaded), is rewritten by the migration; Studio's steps on it then refuse as changed elsewhere.

### 2.5 What each operation writes

| Host | Write path |
|---|---|
| Character | `writeLiveCharacter` + `applyCharacterWrites` (`studioSetters.ts:496`), in place |
| Chat | `writeLiveChat` + `applyChatWrites` (`studioSetters.ts:695`, `liveCharacterWrite.ts:38-56`), in place |
| Module | `writeLiveModule` + `buildWrittenModule` (`studioSetters.ts:576-692`): a new `lorebook` array with copied entries at touched indexes; absent reads empty, the first insert creates it |

| Action | Ops in one step, in order | Notes |
|---|---|---|
| Edit a field | `objSet`, coalesced (4.2) | |
| Case sensitive | `objSet extentions`, the whole container: a spread of the existing object with `risu_case_sensitive` true or false | Undo restores the exact container, absent included |
| Probability control | `objSet content` | 3.3a; label field `probability` |
| Legacy probability field | `objSet activationPercent` | |
| Move legacy value into `@@probability` (D6) | `objSet content`, `objSet activationPercent` → `null` | truthy value only |
| Add entry / folder | `objInsert` | top level at the array end; in a folder after its subtree block |
| Duplicate | `objInsert` after the source | entries only; migrated (2.4) |
| Delete entry | `objRemove` tagged with a new `deletedId` | no confirm; chat links kept (D4) |
| Delete folder | `objRemove` per subtree element, highest index first, all tagged with one `deletedId` | MC-4009 confirm (3.4) |
| Restore from History | `objInsert` per stored entry, ascending, tagged with the item's id | 4.4 |
| Reorder, move in or out | `objSet folder` when the container changes, then `objRemove` + `objInsert` per moved element (untagged) | 2.6 |
| Rename folder | `objSet comment` | |
| Always active (row or form) | `objSet alwaysActive`; on a folder also each direct child | not on child links (E5) |
| Bulk always active | `objSet alwaysActive` on every non-link entry whose value differs | `bulkEnabling`; child links skipped, their value is inert (`lorebook.svelte.ts:517`) |
| Give new ID | `objRemove` + `objInsert` of the entry at its index, the insert holding the new id (untagged) | an identity changes only so (4.0) |
| Local activation on | Character step: remove + insert assigning the id, when the entry has none; then chat step `objInsert` of `{key:'', comment:'', content:'', mode:'child', insertorder:100, alwaysActive:true, secondkey:'', selective:false, id}` (`LoreBookData.svelte:67-78`) | two owners, two steps |
| Local activation off | Chat step: `objRemove` of each link with that id (`:80-87`) | |
| Settings | `propSet loreSettings` (+ `propSet loreExt` on a boundary flag), or registry `set lorePlus` | 3.5 |
| Import | `objInsert` per entry at the array end | 3.6 |

Undoing the character step that assigned the id while the chat link exists leaves the link pointing at nothing, shown as `studioLoreLinkedMissing` (E10, with D4).

### 2.6 Where a move lands

In a container (top level or one folder), the sibling sequence is the elements whose container it is, in array order; each sibling's **block** is an entry alone or a folder with its subtree. The moved block is removed, then inserted contiguously in its own order at the index below (computed after the removal):

| Move | Insert at |
|---|---|
| Up | the previous sibling's first block element (at the top: nothing) |
| Down | after the next sibling's last block element (at the bottom: nothing) |
| To top / To bottom | the first sibling's first element / after the last sibling's last element (empty container: as Add) |
| Into a folder | as Add in that folder |
| Out to the parent container | after the former folder's block |

Other elements keep their relative order. A folder is never offered a move into its own subtree.

## 3. UI

Layout follows SLICE4 §2, long text SLICE3. Theme tokens only. Mobile first: one pane on the phone, 44 dp targets, Back per DD-098.

### 3.1 Where it lives

- The owner tree keeps each owner's paged lorebook kind. A folder row with an empty name shows `sidebarUi.unnamedFolder`, not the raw key (`ownerModel.ts:230`; T31).
- Kind selected: the lorebook list (3.2); for a character, a collapsed Lorebook settings section above it (3.5). Item selected: entry form (3.3), folder form or linked view (3.4). On the phone, Back returns to the list with the row revealed and focused (`revealListRow`).
- Hosts: a character that is not restricted and not a group; the context chat (`ownerModel.ts:386-394`); a loaded, non-private module with its id published and not shared (`StudioDetail.svelte:81-83`, `:116`). A shared module id is read-only with `studioRefusalModuleSharedId` (`:119`, `:232-234`).
- Status: `currentVisitAck()` for character and chat, `currentModuleAck()` for a module (`:221`, `:227`). A chat-host edit is a chat-owner step; header Undo follows the focused owner (SLICE4 §3, DD-189).

### 3.2 The lorebook list (windowed)

- Header: `globalLoreInfo`, `localLoreInfo` or `studioLoreModuleInfo`, and a help disclosure with Help key `lorebook`.
- Row: chevron for folders (expanded state per owner, device-local, DD-099); icon (folder, `book-copy` for a child link); name (`comment`, else `key`, else `sidebarUi.unnamedLore`; folders `comment`, else `sidebarUi.unnamedFolder`); an always-active toggle button (`sun`/`link`, `aria-pressed`, 44 dp; on a folder also the direct children; none on child links); markers for decorator problems, duplicate id and folder missing; a count on folders.
- Single-line 44 px rows, nested by indentation (three levels, deeper shows depth). `createWindowHost` + `WindowedSegment` as in `StudioCombined.svelte`. Row key: a unique `id`, else a folder's `key`, else `@<index>`.
- Toolbar: `+ Entry`, `+ Folder`, `Import`, `Export`, and with `bulkEnabling` a `⋯` menu with the bulk pair.
- Row `⋯` menu (also Shift+F10 or the menu key): Move up, down, to top, to bottom (2.6); Move to folder… (a sheet of top level and every folder except the row and its descendants); Duplicate (entries); Delete.
- Keyboard: Alt+↑/↓ moves the row; Delete deletes (a non-empty folder after the MC-4009 question). Focus then goes to the next row, else the previous. Drag-and-drop reorder is not in S7 (follow-up #718, MC-4080).
- Empty: `studioLoreEmpty` with add and import. Counts, grouping and the duplicate-id set are recomputed from the store on every change (DD-157).

### 3.3 The entry form (MC-4000)

Shown first: **Name** (`comment`, help `loreName`); **Activation keys** (`key`, help `loreActivationKey`, hint `activationKeysInfo`); **Content** (long text, `cbs` mode, token chip, decorator help of 3.7); **Always active**. The rest is in **More options** (`studioLoreMoreOptions(n)`), open by itself when any option is set.

| Field | Key | Control | Rule |
|---|---|---|---|
| Secondary keys | `secondkey` | single line | Shown when `selective` is on or text is present; disabled with `studioLoreSecondaryUnused` when selective is off |
| Selective | `selective` | switch, help `loreSelective` | Disabled with `studioLoreSelectiveRegex` while `useRegex` is on (`LoreBookData.svelte:285`) |
| Regex keys | `useRegex` | switch, help `useRegexLorebook` | Disabled with `studioLoreOptionUnused` while always active (`:291`) |
| Case sensitive | `extentions.risu_case_sensitive` | switch, help `caseSensitiveLorebook` | As regex keys; whole container (2.5) |
| Insert order | `insertorder` | number 0 to 1000 (`:268`), help `loreorder` | |
| Probability | `@@probability` line | number 0 to 100, empty = none | 3.3a |
| Older probability value | `activationPercent` | number 0 to 100, clamped (`:256-263`) | Only while it holds a number |
| Always active in this chat | the chat child link (2.5) | switch | Character host, not always active, a context chat, `localActivationInGlobalLorebook` on (`:280`) |
| Folder | `folder` | select | Moves the entry (2.6) |
| Entry ID | `id` | read-only, copy button | Shared id: `studioLoreDuplicateId`, button `studioLoreNewId`, note `studioLoreNewIdNote` |

A field with a value is never hidden; with no effect it is disabled with a note (keys while always active: `studioLoreKeysUnused`). `lorePlus` hides nothing (D2). **Test lorebook** opens `StudioLoreTester`. Duplicate ids are checked within the host list; fixing one entry leaves the others.

### 3.3a Activation probability (MC-4006)

Facts:
- The scan reads only the decorator: each executed `@@probability` line blocks when `roll × 100 > parseInt(arg[0])` (`lorebook.svelte.ts:744-750`), so two lines multiply, an unreadable argument never blocks, and `100` never blocks (`roll < 1`). The handler returns `undefined`, so the line always leaves the fallback state "not ignored".
- `activationPercent` is read by no scan code; the migration moves a truthy value (2.4).

**Reading.** `readProbabilityLine(content)` uses the block parser of 3.7:

| Found in the leading block | Control | Editable |
|---|---|---|
| None | empty, placeholder `studioLoreProbabilityNone` | yes |
| One `@@probability` with a readable integer | that integer | yes |
| One with an unreadable argument | empty, `studioLoreProbabilityUnreadable` | no |
| Two or more, or any `@@@probability` | empty, `studioLoreProbabilityMany` | no |

A line after the block counts as none (W2 marks it).

**Writing.** `writeProbabilityLine(content, value)` returns the whole content; one `objSet content` writes it. Content outside the touched line is unchanged; held input is flushed first (`fieldFlush.ts`).
- **Set, no leading block:** prepend `@@probability N` and a line break (the migration's form).
- **Set, with a block:** insert directly after the block's last line, so no fallback chain is split.
- **Change:** rewrite only that line; the return value is unchanged.
- **Clear:** remove the line and its line break, **unless the next block line is a fallback line** (`@@@name`, not `@@@end`). Removing it would hand that line the state of the line before, so it could start or stop running (N5). In that layout Clear writes `@@probability 100` instead, which keeps the state and never blocks, and shows `studioLoreProbabilityKept`.

`N` is an integer 0 to 100; other input clamps on blur.

**Side by side.** Each control writes only its own source. The Probability control is labelled as the value the engine uses (`studioLoreProbabilityHint`). While the legacy field holds a number it shows `studioLoreLegacyProbabilityLabel`, `studioLoreLegacyProbability`, and `studioLoreLegacyDiffers(n)` or `studioLoreLegacyNoLine`. **D6:** "Move into @@probability" is offered only when the control is empty and editable and the legacy value is truthy; one step writes the line and sets `activationPercent: null`.

**History.** Label field `probability` for the control and D6, `activationPercent` for the legacy field. Steps coalesce by label field (4.2).

### 3.4 Folder form and linked-entry view

**Folder form:** Folder name (`folderName`); Always active with `studioLoreFolderAlwaysActive`; the entry count; `+ Entry here`; Delete.

**Delete (MC-4009):**
- A folder whose subtree holds anything asks once, in an `alertdialog`: `studioLoreFolderDeleteConfirm(name, n, f)`, where `n` counts the entries (non-folder rows) and `f` the nested folders in the subtree (E4). Buttons `studioLoreDelete` and `cancel`; focus on Cancel; Esc, tap outside and Back cancel; a cancel writes nothing.
- An empty folder deletes without asking.
- Either way one undoable step with one durable deleted item (4.4); the toast shows `studioLoreFolderDeleted(name, n, f)`. Classic asks twice (`LoreBookData.svelte:167-176`).

**Linked entry** (a chat `mode: 'child'` row): read-only `studioLoreLinked(name)` with help `childLoreDesc`; `studioLoreLinkedMissing` when no character entry holds its id; deletable without a confirm; not editable (the scan copies the parent's text at send time, `lorebook.svelte.ts:515-517`).

### 3.5 Lorebook settings (character host)

Mirrors `LoreBookSetting.svelte:86-134`.
- **Use global settings:** on means `loreSettings` is absent, and a read-only line shows the app values (`studioLoreGlobalValues`). Turning it off writes `{ tokenBudget: db.loreBookToken, scanDepth: db.loreBookDepth, recursiveScanning: false }` (`:117-121`). The app-wide values are edited only in Settings (MC-4043); Studio never writes them.
- While off: recursive scanning; full-word matching; ASCII word boundaries (help); CJK word start (help); scan depth 0 to 20; token budget 0 to 4096. The two boundary flags also set or delete `loreExt.risu_fullWordAsciiBoundary` / `loreExt.risu_cjkWordStart` in the same step (`:17-28`).
- **LorePlus** (the character's `lorePlus`) shows only with `useExperimental`, help `lorePlus` and `experimental`; the flag stays in Settings (MC-4043).
- Chat host: `studioLoreSettingsChatNote` with a button to the character's settings. Module host: `studioLoreSettingsModuleNote` (MC-989).
- Number fields write on change, coalesced, clamp on blur.

### 3.6 Import and export

**Export** (every host): the classic bytes `{ type: 'risu', ver: 1, data: list }` to `lorebook_export.json`, via an extracted `lorebookExportBytes(list)` that classic also uses.

**Import** (every host): the picker takes one or more `json`, `lorebook` or `png` files (`ModuleMenu.svelte:173`). Each file is read as classic reads it, via an extracted `parseLorebookImport(bytes)`; classic keeps its verbatim append.

`prepareLoreImport(host, live, imported)` is pure and runs inside the write, after the picker's await, against the live list. Input: every file's elements in pick and file order.
- **Pass 0:** an element that is not a plain object is skipped and counted (E6); `studioLoreImportSkipped(n)` follows the toast.
- **Pass 1, ids and folder keys,** over one taken set (the live ids and folder keys, growing with each accepted element): no id → fresh id (MC-4009), except folder rows; a taken id → fresh id (MC-4004); a taken folder key → fresh key (U+F000 + `folder:` + uuidv4()). The first imported folder of each re-keyed old key records old → new in a remap table; a later same-key folder is re-keyed with no remap and arrives empty.
- **Pass 2, folder references:** an imported entry whose `folder` is in the remap table takes the new key (also children that preceded their folder). Live entries are never touched. A reference no imported folder defines is kept.
- **Pass 3, version (character and module hosts):** `migrateLoreEntryToV2` on every element below version 2 (D7, 2.4).

Chat links follow the same rules; a re-IDed link shows `studioLoreLinkedMissing`. The elements are appended as one step with `studioLoreImported(n)`; when ids or folder keys changed, `studioLoreImportRenamed(ids, folders)` (ids given to id-less entries are not counted). No entries: `studioLoreImportNone`. A PNG without a lorebook: `errors.noData`.

**Known limitation (history only):** a step over the 2 MiB owner cap stops the store's keep walk; it **and every older stored entry of the owner** are dropped from storage (`studioHistoryStore.ts:613-651`), deleted items first. In-memory undo is unaffected until a reload.

### 3.7 Decorator help

**Block parser** (shared with 3.3a), following ccardlib 0.4.2 `Ce`: content and lines trimmed; the leading block runs to the first line not starting with `@@` (a blank line ends it); `@@@end` is `@@end` and always runs; any other `@@@name` runs only when the state is "ignored", which each executed `@@` line sets to (its handler returned `false`); a skipped `@@@` leaves the state; a line with no name resets it; the initial state is "not ignored".

**Table:** `src/ts/process/loreDecoratorTable.ts`, a leaf module, one row per name the scan handles (`lorebook.svelte.ts:536-768`): argument kind and whether required; an example; `returnsIgnored` (true for `keep_activate_after_match`, `dont_activate_after_match`, `:563-588`, and for `instruct_depth`, `reverse_instruct_depth`, `instruct_scan_depth`, `is_user_icon`); `effect: 'none'` for the last four.

**Autocomplete:** `@@` at a line start inside the block opens the SLICE3 §3 list (name, argument hint, `studioLoreDecoHelp.<name>`); inserting writes `@@name `.

**Warnings** via `LongTextField`'s `extraMarks` (`LongTextField.svelte:59`, `:256`):

| Code | Level | Condition | Key |
|---|---|---|---|
| W1 | warning | unknown name | `studioLoreDecoUnknown` |
| W2 | warning | `@@` line after text or a blank line | `studioLoreDecoAfterText` |
| W3 | warning | unreadable or missing required argument (integers for `depth`, `reverse_depth`, `scan_depth` (non-negative), `activate_only_after`, `activate_only_every`, `is_greeting`; `role` ∈ user/assistant/system; `disable_ui_prompt` ∈ post_history_instructions/system_prompt; `position` ∈ `pt_*`, after_desc, before_desc, personality, scenario) | `studioLoreDecoBadArg` |
| W3 | warning | `probability` unreadable | `studioLoreDecoProbabilityNaN` |
| W3 | warning | `priority` unreadable: `NaN` (`:752-754`) makes the sort unpredictable (`:889`) | `studioLoreDecoPriorityNaN` |
| W3 | **error** | `@@position` with no argument: the scan throws (`arg[0].startsWith`, `:632`) | `studioLoreDecoArgMissing` |
| W4 | warning | effect none | `studioLoreDecoIgnored` |
| W5 | info | `@@@name`, except `@@@end` | `studioLoreDecoFallback` |
| W6 | info | two or more executed `probability` lines | `studioLoreDecoProbabilityMany` |

`@@end`/`@@@end` keep SLICE3's deprecated-form info. Block decorator lines take the SLICE3 decorator colour.

### 3.8 Empty, error and refusal states

| State | Shown |
|---|---|
| No entries | `studioLoreEmpty` with add and import |
| Private character or its chat | SLICE4 §1 private rule |
| Group | interim classic (1.1) |
| Module not loaded | the existing stub load, then the list |
| Module id shared | read-only, `studioRefusalModuleSharedId` |
| Module lorebook not a list (`'ask'`) | read-only `studioLoreRepairPending`, no list ops; the build guards `loreKind` with `Array.isArray` (`ownerModel.ts:218-233`) |
| Module list below version 2 (`'migrate'`) | editable (5.3) |
| Write refused | the existing refusal toasts |
| Selected entry gone | `studioLoreEntryGone` |

### 3.9 Selection across list changes

Item ids `<ownerId>/lore:<index>` are valid for the visit (`ownerModel.ts:86-92`). The form tracks its entry by a unique `id`, else by the live entry object (character and chat arrays are edited in place; after its own module writes Studio updates the reference). After its own list op Studio reselects at the builder's new index; after "Give this entry a new ID", by the new id. When the entry cannot be found, the detail drops to the list with `studioLoreEntryGone`.

## 4. History, undo and the save chip

### 4.0 Invariants and closure (r5)

Every obj rule below derives from five invariants. They hold on every route that plans obj ops: commit, undo, redo, revert, restore from History and the restore line.

- **I1, no partial write:** a plan applies whole or writes nothing; a refused plan leaves the stacks and the deleted-item listing as they were.
- **I2, no new holder:** no plan leaves more rows holding an identity (4.1) than the count recorded with the insert that adds it. `id` and folder-key identities enter and leave a list only through `objInsert` and `objRemove`; no `objSet` changes an `id` or a folder key. A `content` identity also changes by `objSet` (below the closure table).
- **I3, no silent overwrite:** a remove or field set applies only to the row whose recorded anchor it finds at its index.
- **I4, a step moves only on a witness:** a step moves between stacks without writing only when every row it would add is shown present and every row it would remove is shown absent, by anchor and count (`already`, 4.2).
- **I5, references are not guarded:** a `folder` value, and a chat child link's `id` as a pointer to a character entry, may dangle; markers show it (D5, `studioLoreLinkedMissing`). A dangling reference is not an I2 breach.

Why counts suffice: every route except Restore from History is last-in-first-out (header Undo and Redo take the stack top; a revert undoes every step above its target, `historyModel.ts:1846-1862`; the line inverts the whole journal). A list differs from what a step recorded only after an outside change or a save that did not finish, so a count refusal needs no recovery design.

Closure table: the rule that enforces I2, I3 and I4 for each op on each route.

| Op | Commit | Undo, redo | Revert | Restore from History | Restore line |
|---|---|---|---|---|---|
| `objInsert` | counts recorded from the working copy | counts "at most"; tag run | same | stored counts; tag run; `studioLoreRestoreIdTaken` | same as revert; `studioLoreRestoreChanged` |
| `objRemove` | anchor | anchor; counts kept for the inverse | anchor | n/a | anchor |
| Identity change (new id; id assigned by local activation) | remove + insert (2.5) | as remove + insert | same | n/a | same |
| `objSet`, other field | anchor + `before`; refused on `id`, `mode`, and `key` on a `mode: 'folder'` row | same | same | n/a | same |
| `propSet` | `before` | `before` | same | n/a | same |
| Move without a write | n/a | `already` by witness (4.2) | never | never | never |

An `objSet` on an id-less row changes its content identity (4.1). That is an edit guarded by I3, not an added row: two rows made equal by edits are user data, as when the user types them. I2 counts the rows that inserts add.

### 4.1 The object-list op family (shared with S6 and S8)

New pure module `src/ts/studio/history/objectListOps.ts`, part of the stored format.

```ts
type ObjListName = 'lore'                        // the lists of OBJ_LIST_HOLDERS (4.1a); S6 adds 'regex'
type ObjEntry = Record<string, unknown>          // plain JSON copy
type ObjFieldValue = { had: false } | { had: true; value: string | number | boolean | null | ObjEntry }
type IdentityCounts = { id?: number; folderKey?: number; content?: number }   // positive integers

| { op: 'objInsert'; list: ObjListName; index: number; entry: ObjEntry; counts: IdentityCounts; deletedId?: string }
| { op: 'objRemove'; list: ObjListName; index: number; entry: ObjEntry; counts: IdentityCounts; deletedId?: string }
| { op: 'objSet'; list: ObjListName; index: number; field: string;
    before: ObjFieldValue; after: ObjFieldValue; anchorBefore: number; anchorAfter: number }
| { op: 'propSet'; prop: PropName; before: PropValue; after: PropValue }   // PropValue: {had:false} | {had:true; value: object}
```

- **Anchor:** `entryAnchor(list, entry) = fingerprintElement(canonicalJson(entry without the list's anchor-excluded keys))` (`listFingerprint.ts:28-34`); for `lore` that is `bookVersion` (4.1a). `canonicalJson` has `JSON.stringify` value semantics (undefined omitted, `NaN`/infinities → `null`) with object keys sorted at every depth. Leaving out `bookVersion` lets a stamp-only migration pass (2.4). The anchor is total over live elements (4.1a, R1).
- **Value equality** for `objSet` fields and `propSet` is canonical-JSON equality, never `===` (E3).
- **Identities** come from the list's `OBJ_LIST_IDENTITY` row (4.1a; S6 and S8 state their own). A `lore` row that is a plain object holds a set:
  - `id`: a non-empty string `id`;
  - `folderKey`: the `key` of a folder row, defined as classic defines it: `mode === 'folder'` and a non-empty string `key` (`lorebookFolders.ts:13`, `:20`). A folder row can also hold an `id` (classic import appends verbatim, and 3.6 keeps a free id), and then holds both;
  - `content`: only for a row holding neither; its canonical JSON without `bookVersion`. This is the whole row, not the scan's identity: the scan hashes only the `content` field and treats `id: ''` as an id (2.1). The whole row guards I2 without refusing two different rows that share a `content` field.
- **`counts`** is required on every `objInsert`, `objRemove` and deleted-item element, with exactly the kinds its `entry` holds; the parser refuses any other key set. Each count is the number of rows holding that identity, this one included, after the insert or before the remove. It is computed on the working copy one op at a time, so a folder delete with two sharers records 2, then 1. A `content` count compares only rows that hold no other identity, pre-filtered by anchor.
- **`deletedId`** tags the op as moving an element of a deleted item (4.4).
- **Inversion:** `objInsert` ↔ `objRemove` with the same index, entry, `counts` and `deletedId`; `objSet` and `propSet` swap their sides and anchors.
- **`LORE_FIELDS`**, the `lore` row of `OBJ_LIST_FIELDS` (4.1a; append-only, frozen by a test): `comment`, `key`, `secondkey`, `content` (text); `insertorder` (finite number); `alwaysActive`, `selective`, `useRegex` (bool); `extentions` (object or absent, whole container); `activationPercent` (finite number or null); `folder` (text, `{had:false}` deletes). Every lore field accepts `{had:false}` on either side, since a stored row may lack any key. `id`, `mode` and `bookVersion` are never set by `objSet`, nor `key` on a `mode: 'folder'` row (empty key included); an id changes only by remove + insert (2.5). `probability` is a label-only field.
- **`OBJ_PROPS`** and **`OBJ_LIST_HOLDERS`**: 4.1a.
- `LiveReader` gains `objList?(list)` and `prop?(name)`; `WriteOp` gains the four ops (never stored, `historyModel.ts:675-685`).
- **Step rule:** builders put obj and `propSet` ops only in steps that hold no other op. The exceptions are a History revert step and the restore-point step (4.2, 4.6).

### 4.1a The shared seam: per-list tables (r6, #684 R1 to R8)

S6 regex reuses section 4 as the single object-list seam, and S8 adds its rows. Every list-dependent rule reads the list's row; no rule outside the tables names `lore`. The tables live in a pure data module, `history/objectLists.ts`, so a test can replace it with a probe row while the planner and parser run their real bodies (the `sessionKinds.ts` precedent). The `lore` row is r5's rules, unchanged:

| Table | `lore` row |
|---|---|
| `OBJ_LIST_HOLDERS` | stored kinds: character `globalLore`, chat `localLore`, module `lorebook` (S8 adds `group`); session kinds: none |
| `OBJ_LIST_FIELDS` | `LORE_FIELDS` (4.1): each field's value kind, `{had:false}` allowed; label-only field `probability`; refused per element: `key` on a `mode: 'folder'` row |
| `OBJ_LIST_IDENTITY` | `id`, `folderKey`, `content` (4.1) |
| Anchor-excluded keys | `bookVersion` |
| `OBJ_PROPS` | character `loreSettings`, `loreExt` (whole objects, unknown keys kept), journaled with `lore` |
| Asset-merge prefix | `lore/` |
| Message keys | line `studioLoreRestoreLine`, refusal `studioLoreRestoreChanged`, earlier-visit note `studioLoreRestoreEarlierVisit`, count refusal `studioLoreRestoreIdTaken`, mixed revert `studioLoreRevertMixed` |

Rules over the tables:
- **Totality (R1).** A live list may hold elements that are not plain objects: classic `importLoreBook` pushes a risu file's elements verbatim (`lorebook.svelte.ts:1019-1023`), and classic regex import does the same. Such an element holds no identity, so counts skip it; its anchor is `fingerprintElement` of its canonical JSON; an `objSet` on it refuses. When canonical JSON cannot be computed (a bigint or a cycle), the element's anchor and canonical value equal nothing, so a plan touching it refuses and never throws. An op's own `entry` stays a plain object (parser unchanged), and builders emit no op on such an element. Every other S7 reader of a live lore list also skips such elements without throwing: grouping and counts, the duplicate-id set, the Studio tree, the deep link's id lookup, bulk always active, the Move to folder sheet and focus after delete. Export keeps them, because it writes the list verbatim (3.6). How the lorebook list shows one is 18, Q1.
- **Fields (R2).** The parser, the `objSet` precondition (4.2) and `ObjLabelField` (4.3) take the field vocabulary from the list's `OBJ_LIST_FIELDS` row.
- **Kind acceptance (R3).** `isOpAllowedFor` and the parser accept an obj op or obj deleted item only on a record whose kind the list's `OBJ_LIST_HOLDERS` row names, and a `propSet` only on the kind its `OBJ_PROPS` row names; anything else refuses the record whole. For `lore` these are exactly 7.1's kinds, so no lore record parses differently.
- **Unknown names (R8).** A record naming a list, a field or a label field that this build's tables do not hold is refused whole (MC-1827 (a)). A build with S7 and without S6 therefore refuses `list: 'regex'` whole.
- **Session kinds (R6).** `OBJ_LIST_HOLDERS` may name a session kind (`sessionKinds.ts`) whose session spec names the list. The session spec is the source: the session kind's `OBJ_LIST_HOLDERS` entry is derived from it, and a module-load check (like `isSessionRows`, `historyModel.ts:45-58`) refuses a mismatch. For that kind `isOpAllowedFor` reads the session spec, the service takes `objList` and the write from the session adapter (`sessionAdapters.ts`), and nothing is stored (MC-1758). S7 adds no session row; S6c adds the preset row and its test.
- **Journal, lines and mixed revert (R4, R5):** per list, 4.6 and 4.2.
- **Worker path (R7).** Obj ops and items travel through `studioStoreProtocol`'s `diffEntry` and `applyEdits` unchanged; T57 pins that payloads shaped like field values, own `__proto__` keys and deep nesting survive.

### 4.2 `planObjStep`: one all-or-nothing planner (N2)

The existing `planReplay` (`historyModel.ts:1474-1694`) and `planRevert` (`:1849-…`) apply op by op: a failing op is skipped or kept and the rest still write. Obj ops never enter those loops.

`planObjStep(ops, live, listed, tags = true)` is pure. It plans `ops` in the given order on a working copy of the touched lists and props and of the set of listed deleted-item ids. Any failing check refuses the whole plan: no write, no move.

| Op | Precondition |
|---|---|
| `objInsert` | `0 ≤ index ≤ length`; for each kind in `counts`, at most `counts[kind]` rows hold that identity after the insert |
| `objRemove` | `entryAnchor(live[index])` equals `entryAnchor(op.entry)` |
| `objSet` | `field` is in the list's `OBJ_LIST_FIELDS` row and not refused for this element (lore: `key` on a `mode: 'folder'` row, empty key included); the live element is a plain object; its anchor equals `anchorBefore`; the field equals `before` |
| `propSet` | the prop equals `before` |

**Tag rule, per run (E1; skipped when `tags` is false).** A maximal run of consecutive ops with the same `deletedId` D and the same kind is checked against the working listing at the run's start: an insert run needs D listed, a remove run needs D unlisted. At the run's end a remove run lists D (4.4) and an insert run consumes it. A revert across a delete and its restore therefore lists D through the restore's inverse removes before the delete's inverse inserts consume it.

"At most" (r4, unchanged): history never adds a holder beyond what the user had when the step was recorded. A move nets zero; undo of deleting one of two sharers succeeds, also after the other sharer was re-IDed; a replay after an outside change added a holder is refused.

**Callers** (greeting and asset paths unchanged):
- **Undo or redo of a step of obj and `propSet` ops only:** `planReplay` returns `planObjStep` on the step's ops (redo), or on the inverted ops in reverse order (undo):
  - planned: write and move;
  - the first failure is an insert run whose D is not listed (the item left History: restored, or pushed out by `MAX_DELETED`): `dropStep`, nothing written, as `plainUndo` does today (`:1533-1539`, `:1657`);
  - otherwise, when the opposite direction plans with `tags` false and every insert in that plan carries counts: `already` (I4). Nothing is written; the step moves and applies its direction's listing effect: it lists D built from the step's own tagged ops only, or consumes D; when that already holds, D is left as it is and not rebuilt (review 4 ruling). This covers a replay whose data save landed while its history save did not: rows decide, and the listing is corrected;
  - otherwise `precondition`: the step stays and Undo stops at it, as for a fingerprinted greeting step today (`:1493-1497`).
- **Mixed step** (a revert step or the restore-point step): its obj and `propSet` ops go to `planObjStep` first, as a gate; the others go to today's loop unchanged. A refusal of the obj half refuses the replay as `precondition` before any write. A mixed step never takes `already` or `dropStep` (11). Obj ops touch only obj lists and their props; nothing else touches them except an asset merge's `textEdit` under a list's prefix (lore: `lore/…`), which never shares a step with obj ops (next item).
- **History revert (`planRevert`):** the obj and `propSet` ops of the reverted steps are inverted newest first into one sequence and planned once by `planObjStep`. A refusal refuses the whole revert (the existing refusal). Other ops keep today's per-op handling, so a revert without lore steps is unchanged. A range that holds obj ops and an asset merge's `textEdit` under any obj list's prefix is refused with that list's mixed-revert key (R5; for `lore/`, `studioLoreRevertMixed`).
- **Restore from History** of an obj item: `objInsert` per stored element, ascending, each index clamped to the working length, tagged D, with the stored `counts`; label `{ kind: 'restoreDeleted', deletedId }`. A count refusal shows the list's count-refusal key (lore: `studioLoreRestoreIdTaken`).

**Coalescing (E1):** a one-`objSet` step extends the open step when list, index, field and label field match within `COALESCE_MS`. `mergeCoalesced` (`:2645-2658`) gains `objSet`: first op's `before` and `anchorBefore`, last op's `after` and `anchorAfter`.

The asset merge's `textEdit lore/<i>/content` keeps its text precondition and is not an obj op.

### 4.3 Step labels

Strictly parsed with `hasOnlyKeys`:
- `{ kind: 'obj'; list; action: ObjAction; name: string | null; count?: number; field?: ObjLabelField }`; `ObjAction` = `add | delete | edit | move | duplicate | import | folderCreate | folderRename | folderDelete | folderActive | bulkActive | newId | link | unlink`; `ObjLabelField` = a field or label-only field of the list's `OBJ_LIST_FIELDS` row (lore: a `LORE_FIELDS` name or `probability`); `list` must be a known list (R8).
- `{ kind: 'prop'; prop }` for settings.
- `{ kind: 'restoreDeleted', deletedId }` (existing) now also on chat and module owners, with obj ops.

### 4.4 Deleted items: one tag rule (N1)

Shape: `{ id, at, list: ObjListName, entries: { index: number; entry: ObjEntry; counts: IdentityCounts }[] }`, entries in ascending index, **no top-level `value`, `index` or `sideChat`**.

One rule, applied wherever `planObjStep` runs with `tags` (commit, undo, redo, revert, restore, the restore line):
- **Listing:** a plan that applies removes tagged D lists D, built from those removes (`index`, `entry`, `counts`), ascending. All removes of one delete step share one D; a folder delete removes highest index first, so each index is the element's original position.
- **Consuming:** a plan that applies inserts tagged D consumes D.

The rest follows without extra bookkeeping (no `producedItems`, `deletedEntryFor` or pair/consume maps for obj items):
- Restoring D consumes it; a later undo of the delete meets an unlisted D and is dropped. So a folder or id-less entry never comes back twice; the counts refuse it even when the listing is wrong (4.0).
- Undoing the restore lists D again (its inverse removes are tagged D), and the delete's undo works again.
- A revert across a delete and its restore nets to nothing: the restore's inverse lists D, the delete's inverse consumes it.
- An item is complete from its ops, so a restore after the delete step left both stacks keeps the count rule.

Character, chat and module owners hold these items; greeting items stay character-only. `MAX_DELETED` (50) counts both shapes. Known limitation: past 50 listed items the oldest are evicted. Then the line's inverse inserts of an evicted item refuse with `studioLoreRestoreChanged`; header Undo of that delete takes `dropStep`, so the delete can no longer be undone (today's greeting `plainUndo` behaviour); and a revert across that delete is refused whole. The note's wording is a Gate 2 item (10.1).

### 4.5 Save chip and changed elsewhere

Unchanged.

### 4.6 Restore point: the visit journal (MC-4008, N4)

No snapshot: no lore path in `RESTORE_PATHS_BY_KIND`. `lorePlus` joins the character's restore row as a registry path (7.1).

- **Creation (F4's first half, reinstated in r5):** an edit commit whose ops include obj or `propSet` ops creates or replaces the point as a field edit does, even with no restore writes. In a visit other than the stored point's, the point becomes `{ visitId, at, fields: {} }` (the v2 parser reads empty `fields`, `historyModel.ts:581-608`). `noteRestoreWrites` keeps its zero-write early return (`:2535-2537`) for every other commit (asset steps) and for every replay, revert and restore, so replays never create a point, as for fields (`replaces: false`, `:2777`, `ownerHistory.svelte.ts:1008`).
- **Journal:** in memory, per owner, visit and list (R4; `studioScreen.visitId` is new on every `openStudio`, `studioScreen.svelte.ts:47`, `:182`). Every plan that writes in this visit, as applied (commits, undo, redo, revert, restore from History), adds its ops on each list, together with its ops on that list's props, to that list's journal as one entry holding references to the plan's op objects, unless the tail-merge applies. A list's journal resets when its line applies (E2(a)).
- **Tail-merge (R9).** When the entry this plan would add (its ops on the list together with its ops on that list's props) is exactly one `objSet`, and the list's last journal entry is exactly one `objSet` on the same index and field whose `anchorAfter` equals the new op's `anchorBefore` and whose `after` canonical-equals the new `before`, the last entry is replaced by one new merged `objSet`: the entry's `before` and `anchorBefore`, the new op's `after` and `anchorAfter` (the `mergeCoalesced` shape, 4.2). The merge always builds a new op object and never changes the entry's op in place: journal entries reference the plans' op objects, which the owner record's steps share (`ownerHistory.svelte.ts:944` passes `built.ops` to `commitStep`, which stores them as the step's `ops`, `historyModel.ts:2684`), so an in-place change would rewrite a recorded step. A plan whose entry is exactly one `propSet` merges the same way into a one-`propSet` entry on the same prop whose `after` equals its `before`. This holds for a commit, an undo, a redo or a revert alike, and whatever the pause between them: neither `COALESCE_MS` nor the record's 100-step cap (`historyModel.ts:18-19`) applies, because the line plans the whole journal at once and needs only the net ops. The merge is sound because consecutive ops of a run meet at an equal anchor and value, so the merged inverse applies exactly when the run's inverses would. A merged entry whose `before` canonical-equals its `after` is removed: it would write nothing, and `n` does not count it. Any other plan appends its entry.
- **Memory bound (R9).** A list's journal holds one entry per run of one-field writes to one row and field (or one prop) that no other entry of that list interrupts, plus one per other applied plan. An `objSet` entry retains two field values (the run's first `before` and last `after`), an insert or remove entry its element, a `propSet` entry two prop objects. Retained memory therefore follows the number of row, field and prop switches and list operations in the visit, not keystrokes, steps or pauses: an hour of typing in one 25,000-character content field is one entry of about two field values. The journal has no count cap; the build measures it (10.1), and MC-4008 already allows a "cannot be reverted" case if a limit is ever needed. It is released when its line applies or the next `openStudio` starts a visit.
- **Visibility.** The service's view offers the point by this table, so the panel's `{#if view.restore}` (`StudioHistoryPanel.svelte:293`) and the sheet's `disabled={!restore}` (`StudioRestoreSheet.svelte:111`) need no change:

| Stored point | Its fields | Journal | Section and sheet |
|---|---|---|---|
| none | – | any | not shown |
| this visit's | some | empty | field rows (today) |
| this visit's | some | not empty | field rows and the lorebook line |
| this visit's | none | not empty | the lorebook line only |
| this visit's | none | empty (the line applied, or its edits netted out) | not shown |
| an earlier visit's | some | any | field rows and the D8 note; no lorebook line |
| an earlier visit's | none | any | not shown (a reload after a lorebook-only visit) |

With several lists, "empty" means every list's journal and "not empty" any list's; each list with entries shows its own line with its row's keys (4.1a).

- **The line** "Lorebook: undo n changes" (`n` = entries in the lore journal, after the tail-merge) shows only on this visit's point. A replay-only visit creates no point and shows no line, as for fields; once a later edit creates the point, the journal still holds the visit's earlier replays, so the line returns the lorebook to the visit start.
- **D8 note** (`studioLoreRestoreEarlierVisit`; per list, from its row) on an earlier visit's point of an owner that holds a lorebook: lorebook changes since then are not reverted there. It is fixed and always true, since that point never carries the line. MC-4008's "the sheet says those cannot be reverted" lands here: the journal has no trimmed case.
- **Choosing the line** inverts the list's whole journal newest first and plans it once with `planObjStep`. Each list's line plans on its own (R4; #684 review 4 E-n). The applied lines commit as one step with the restore's field writes (SLICE1 §5), or alone. Deleted items return to their visit-start listing by the tag rule.
- **Refusal:** the lorebook stays as it is with `studioLoreRestoreChanged`; other lists' lines and the field writes proceed as today.

## 5. Interaction with other parts

### 5.1 ChroMemory §5.4 (#687)

Ids stay stable except for undoing "Give this entry a new ID" (2.3). An edit of an id-less entry's content changes its content-hash identity, Probability edits included. New, duplicated and imported entries get fresh unique ids; duplicates are marked (MC-4005). **O2 (narrowed):** §5.4 makes child-mode entries ineligible (`chromemory-spec.md:363`). #687 should confirm that its shared-identity count also runs over eligible entries only, so a locally activated parent is not skipped because its chat link shares its id.

### 5.2 Lore tester

Unchanged; the form links to it.

### 5.3 Module repair question (MC-623/627/629/1233)

`lorebookRepairNeed` (`moduleLorebookRepair.ts:50-58`):
- **`'ask'`** (not a list): read-only with `studioLoreRepairPending`; Studio never writes it.
- **`'migrate'`** (a list with an entry below version 2): editable. It arises from classic module adds (`ModuleMenu.svelte:116-149`) and older risu files; Studio's own adds, imports and duplicates write version 2 (2.4). Boot and every stub load migrate it (2.4).
- **`'none'`:** editable.

### 5.4 Multi-tab and other editors

Unchanged. Anchors and identity counts refuse replays over outside changes.

### 5.5 Search and merged view

Unchanged; a hit opens the entry form.

## 6. Deep link from a reply (MC-3334, MC-4007)

- **Producer:** `usedEntryOf` (`lorebook.svelte.ts:213-224`) adds `entryId` for a non-empty string `id`. `LoreUsedEntry` (`loreUse.ts:9-15`) gains `entryId?: string`, memory only (MC-3333).
- **Index fix (T1):** a module entry's reported `index` is its position in the concatenation of every enabled module's lorebook (`modules.ts:959-976`, `lorebook.svelte.ts:222-223`), but `loreEntryTarget` reads it as the position in that module's list (`loreUse.ts:8`, `:60-64`). `getModuleLorebooks` also records each module's start offset while joining, and `usedEntryOf` subtracts the start of the module holding the index (E9). Related existing defect fixed in the same place: a non-array `lorebook` is joined as one element while `owners` gets none (`modules.ts:966-972`), which shifts every later module; `owners` gets one id per joined element.
- **Targets:** `LoreEntryTarget` (`loreUse.ts:48-53`) gains `entry?: string`, set from `entryId`; `StudioTarget` (`studioTarget.ts:12-18`) gains `entry?: string` (query `entry=`, lore kind; unknown keys are ignored, `:52-55`); `studioTargetOfLoreEntry` (`openLoreEntry.ts:5-9`) passes it.
- **Resolution:** `applyStudioTarget` opens the one entry holding the id; none or several → the list with `studioLoreEntryGone`. Entries without an id keep MC-3334's rule.
- **Classic fallback:** unchanged (`openLoreEntry.ts:16-23`).

## 7. Stored history format and older builds

### 7.1 What changes

| Shape | New in S7 |
|---|---|
| Op | `objInsert`, `objRemove` (required `counts`, optional `deletedId`), `objSet` (never `id`), `propSet` |
| Label | `{kind:'obj',…}`, `{kind:'prop',…}`; `restoreDeleted` on chat and module owners |
| Deleted item | `{id, at, list, entries: {index, entry, counts}[]}`, no `value`, `index` or `sideChat` |
| Owner kinds | per (list, kind) from `OBJ_LIST_HOLDERS` and per prop from `OBJ_PROPS` (4.1a); for `lore`, obj ops and items on `character`, `chat`, `module`, and `propSet` on `character` |
| Registry | `lorePlus` (bool, `['character']`, `absent: 'delete'`, `editWhenAbsent: true`) in `FIELD_SPECS`, with a `FIELD_PRESENTATION` row (`labelKey: 'lorePlus'`, focus target the settings switch; `fieldRegistry.ts:49-99`, E8). It also joins the character's derived restore row (`historyModel.ts:60-74`). |
| Restore point | no shape change; a lorebook-only visit stores a point with empty `fields`, which v2 already reads (4.6) |

### 7.2 Version: stays 2 (MC-1827)

(a) Older builds refuse every new shape whole: an unknown op (`historyModel.ts:497-499`, via `:516-520`, `:625-629`); an unknown label (`:346-347`); a deleted item without a string `value` and integer `index` (`:543-551`) or on a chat or module owner (`:641`); an unknown registry path in a set op (`:263-265`) or restore field (`:592-595`). The store parses the whole record once (`studioHistoryStore.ts:475-477`). (b) The S7 reader reads every v2 shape. (c) An older build sets the record aside without overwriting it (`studioHistoryStore.ts:497-512`). The rule comment beside `HISTORY_FORMAT_VERSION` gains S7's shapes; no migration (MC-350). T5 pins that no new shape parses as an old one. (d) The S7 parser refuses whole a record naming a list, field or label field its tables do not hold (R8, T56).

## 8. Proposed `en.ts` keys

**Reused:** `name`, `activationKeys`, `activationKeysInfo`, `SecondaryKeys`, `selective`, `useRegexLorebook`, `caseSensitive`, `insertOrder`, `activationProbability`, `alwaysActive`, `alwaysActiveInChat`, `childLoreDesc`, `folderName`, `prompt`, `loreBookDepth`, `loreBookToken`, `recursiveScanning`, `fullWordMatching`, `fullWordAsciiBoundary`, `cjkWordStart`, `useGlobalSettings`, `lorePlus`, `globalLoreInfo`, `localLoreInfo`, `sidebarUi.unnamedLore`, `sidebarUi.unnamedFolder`, `import`, `export`, `cancel`, `successExport`, `errors.noData`, `studioRefusalModuleSharedId`, `studioLoreTest*`; Help keys `lorebook`, `loreName`, `loreActivationKey`, `loreorder`, `loreSelective`, `useRegexLorebook`, `caseSensitiveLorebook`, `fullWordAsciiBoundary`, `cjkWordStart`, `lorePlus`, `experimental`.

**New** (English; the translator writes the other seven):

| Key | English |
|---|---|
| `studioLoreList` | Lorebook entries |
| `studioLoreModuleInfo` | Module lorebook entries apply wherever this module is on. |
| `studioLoreAddEntry` / `studioLoreAddFolder` / `studioLoreAddEntryHere` | Add entry / Add folder / Add entry in this folder |
| `studioLoreEmpty` | No entries yet. Add one or import a lorebook file. |
| `studioLoreFolderCount(n)` | 1 entry / {n} entries |
| `studioLoreMoreOptions(n)` | More options / More options ({n} set) |
| `studioLoreKeysUnused` | Keys aren't used while Always active is on. |
| `studioLoreSecondaryUnused` | Secondary keys are used only when Selective is on. |
| `studioLoreSelectiveRegex` | Selective isn't used with regex keys. |
| `studioLoreOptionUnused` | This isn't used while Always active is on. |
| `studioLoreProbabilityHint` | The chance, in percent, that this entry activates when it matches. Saved as an @@probability line at the top of the content. |
| `studioLoreProbabilityNone` | Not set: activates every time it matches |
| `studioLoreProbabilityUnreadable` | The @@probability line in the content can't be read, so it never blocks this entry. Fix it in the content. |
| `studioLoreProbabilityMany` | Set by several @@probability lines in the content. Edit them there. |
| `studioLoreProbabilityKept` | Set to 100 instead of removed: the next decorator line depends on this one. |
| `studioLoreLegacyProbabilityLabel` | Older probability value |
| `studioLoreLegacyProbability` | Not read by the lorebook engine. |
| `studioLoreLegacyDiffers(n)` | The engine uses the @@probability line ({n}%) instead. |
| `studioLoreLegacyNoLine` | Without an @@probability line, this entry activates every time it matches. |
| `studioLoreLegacyMove` | Move into @@probability |
| `studioLoreFolder` / `studioLoreTopLevel` | Folder / No folder |
| `studioLoreFolderMissing` | Its folder no longer exists. |
| `studioLoreMoveOut` | Move out of folder |
| `studioLoreMoveUp` / `MoveDown` / `MoveTop` / `MoveBottom` / `MoveToFolder` | Move up / Move down / Move to top / Move to bottom / Move to folder… |
| `studioLoreDuplicate` / `studioLoreDelete` | Duplicate / Delete |
| `studioLoreDeleted(name)` | Deleted "{name}" |
| `studioLoreFolderDeleteConfirm(name, n, f)` | Delete folder "{name}" with {n} entries and {f} folders in it? You can undo this. (plural forms per locale; a zero part is left out) |
| `studioLoreFolderDeleted(name, n, f)` | Deleted folder "{name}" with {n} entries and {f} folders (same plural rule) |
| `studioLoreFolderAlwaysActive` | Also sets the entries directly in this folder. |
| `studioLoreAlwaysActiveToggle(name)` | Always active: {name} |
| `studioLoreLinked(name)` | Linked to "{name}" in the character lorebook |
| `studioLoreLinkedMissing` | The linked character entry no longer exists. |
| `studioLoreEntryId` / `studioLoreCopyId` | Entry ID / Copy ID |
| `studioLoreDuplicateId` | Another entry in this lorebook has the same ID. Memory recall skips both, and chat links may reach the other one. |
| `studioLoreNewId` | Give this entry a new ID |
| `studioLoreNewIdNote` | Its chat links and memory flags start over. |
| `studioLoreRestoreIdTaken` | Can't restore: this lorebook already has an entry or folder with the same ID, folder key or content. |
| `studioLoreRevertMixed` | This range includes an asset merge that changed lorebook text, so it can't be reverted in one go. Undo steps one at a time. |
| `studioLoreTestLink` | Test lorebook |
| `studioLoreSettings` | Lorebook settings |
| `studioLoreGlobalValues(depth, tokens)` | Using the app settings: search depth {depth}, max tokens {tokens} |
| `studioLoreSettingsChatNote` | Chat lorebook entries use the character's lorebook settings. |
| `studioLoreSettingsOpen` | Open character settings |
| `studioLoreSettingsModuleNote` | Module lorebook entries use the lorebook settings of the character you chat with. |
| `studioLoreImported(n)` | Imported 1 entry / Imported {n} entries |
| `studioLoreImportRenamed(ids, folders)` | Already in this lorebook, so changed: {ids} entry IDs, {folders} folders (plural forms; a zero part is left out) |
| `studioLoreImportSkipped(n)` | Skipped 1 item / {n} items that aren't lorebook entries. |
| `studioLoreImportNone` | This file has no lorebook entries. |
| `studioLoreBulkActive` / `studioLoreBulkKeys` | Make all always active / Make all key-activated |
| `studioLoreRepairPending` | This module's lorebook isn't a list and needs repair before it can be edited. Answer the repair question first. |
| `studioLoreEntryGone` | That entry isn't in this lorebook anymore. Showing the list. |
| `studioLoreRestoreLine(n)` | Lorebook: undo 1 change / undo {n} changes |
| `studioLoreRestoreChanged` | The lorebook changed elsewhere since, so it's left as it is. Use History to undo single steps. |
| `studioLoreRestoreEarlierVisit` | Lorebook changes since then aren't undone here. Use History to undo them. |
| `studioLoreDecoUnknown(name)` | @@{name} isn't a decorator this app knows. It's ignored. |
| `studioLoreDecoAfterText` | Decorators work only at the top of the content, before any text or blank line. This line is sent as text. |
| `studioLoreDecoBadArg(name)` | @@{name} has a value the app can't read. It's ignored. |
| `studioLoreDecoArgMissing(name)` | @@{name} needs a value. Without one, the lorebook can't be read when a message is sent. |
| `studioLoreDecoProbabilityNaN` | This @@probability value can't be read, so it never blocks the entry. |
| `studioLoreDecoPriorityNaN` | This @@priority value can't be read, so this entry's place among the others becomes unpredictable. |
| `studioLoreDecoProbabilityMany` | Each @@probability line rolls separately, so the chances multiply. |
| `studioLoreDecoIgnored(name)` | This app ignores @@{name}. |
| `studioLoreDecoFallback` | Runs only when the last decorator that ran was ignored. |
| `studioLoreDecoHelp.<name>` | One line per table row (3.7) |
| `studioLoreNonEntryRow` | This item isn't a lorebook entry. It is kept as it is. (MC-4081) |
| `studioLoreStep*` | History labels: Add, Delete(name), Edit(field), Probability, Move, Duplicate, Import(n), FolderCreate(name), FolderRename(from, to), FolderDelete(name, n, f), FolderActive, BulkActive(n), NewId, Link, Unlink, Settings |

## 9. Required tests

Classes: **R** regression reproducer (fails on the named pre-fix base for the intended defect); **C** compatibility guard (passes before and after); **A** acceptance of new behaviour (fails before only because the code is absent; not a reproducer); **D** diagnostic. Every R is DESIGNED, NOT DEMONSTRATED until Gate 2 shows its pre-fix failure.

Fixtures are built like the real producers (MC-329): characters from `createBlankChar`; entries and folders from classic `addLorebook`/`addLorebookFolder` and the `ModuleMenu.svelte` shapes; modules through the module import path; child links as `activateLocally` writes them; legacy probability entries as `updateLorebooks` input and as risu files with `bookVersion: 2`; external books from `convertExternalLorebook`. No sanitizer output is asserted (MC-239 would apply).

| ID | Scenario | Class | Pre-fix base and expected failure | Fixture |
|---|---|---|---|---|
| T1 | A module entry's reported index is its position in its own module; a non-array module lorebook before it does not shift it | R | On `71882fe16` the entry at position k of the second enabled module reports the first module's length + k | two modules (one with a non-array lorebook), probe scan |
| T2 | Deep link by id after reorder and rename (MC-4007) | A | n/a | ids |
| T3 | Shared or gone id opens the list with the notice | A | n/a | |
| T4 | An id-less used entry keeps the index-and-name rule | C | passes before and after | classic entries |
| T5 | v2 base vocabulary frozen; no S7 op or label in it; the obj item has none of `value`, `index`, `sideChat` | C | | |
| T6 | `71882fe16`'s `parseOwnerRecord` returns null for every S7 record | D | scratch checkout outside the repo | S7 records |
| T7 | The S7 reader reads `historyV2.b0.json` and the golden bytes | C | | existing |
| T8 | Every new shape round-trips | A | n/a | |
| T9 | Anchor: key order ignored, every value change seen (unknown keys too), `bookVersion` ignored, equal to the JSON copy's anchor with `undefined`/`NaN` values | A | n/a | |
| T10 | `objSet` undo refused after an outside change | A | n/a | |
| T11 | `objRemove` replay refused when the index shifted | A | n/a | |
| T12 | Add, undo, redo keeps the id; redo after an outside insert of that id is refused | A | n/a | |
| T13 | New entry, folder and duplicate: fresh unique id (folder none), version 2, folder key starts with U+F000 then `folder:`, other keys as classic | A | n/a | classic shapes |
| T14 | Module: a Studio add keeps `'none'`; a `'migrate'` module (classic add) stays editable; a Studio import of a CC book leaves no entry below version 2, and the import still undoes after `repairModuleLorebook` | A | n/a | `ModuleMenu` shapes; CC v2 book |
| T15 | Nested folder delete is one step with one item listing the whole subtree (per-run tag rule); `counts.id` 2 then 1 for two sharers, `content` 2 then 1 for two id-less twins; restore puts back every index and id | A | n/a | |
| T16 | Move out deletes `folder` | A | n/a | |
| T17 | A folder move is one contiguous block | A | n/a | non-contiguous data |
| T17a | Up, down, top, bottom, into, out land per 2.6 | A | n/a | interleaved folders |
| T18 | Folder always active (form and row) sets folder and direct children only; no row toggle on child links; bulk skips links | A | n/a | |
| T19 | Unknown keys and `loreCache` survive every op, export and import | A | n/a | |
| T20 | Studio-edited lore survives the upstream `.bin` encode and decode | C | | existing harness |
| T21 | Chat host writes through `writeLiveChat` and marks | A | n/a | |
| T22 | Module writes copy-on-write; refused for stub, shared id, `'ask'`; allowed for `'migrate'` | A | n/a | |
| T23 | Settings seeding, `loreExt` sync, undo | A | n/a | |
| T24 | Local activation on (id assigned) and off | A | n/a | |
| T25 | Several-file risu and `entries` import is one step; classic `importLoreBook` unchanged after extraction | C (classic) / A | classic part passes before and after | |
| T25a | Collisions (MC-4004, MC-4009): taken id fresh, free id kept, id-less entry gets one, id-less folder stays without; within-file duplicates; counts | A | n/a | one export imported twice |
| T25b | Folder collisions: U+F000 key; children before their folder follow it; second same-key folder empty; live untouched; undefined reference kept | A | n/a | |
| T26 | Export bytes equal classic's | C | | |
| T27 | Table against scan: `@@name arg` + `@@@probability 0` records `0` exactly when `returnsIgnored`; `@@probability 50` + `@@@activate` leaves `forcedBy` unset | C | | probe scan, `roll` stubbed |
| T28 | W1 to W6 on the right lines: blank line ends the block; `@@position` without argument is an error; `priority` NaN; `@@@end` not W5; skipped `@@@` keeps the state | A | n/a | |
| T29 | The windowed list mounts only the band for 2 000 entries | A | n/a | |
| T30 | Duplicate-id marker per list; new-id fix is one step; selection follows | A | n/a | |
| T31 | The tree names an unnamed folder | R | On `71882fe16` the item name is the raw key | `addLorebookFolder`, comment `''` |
| T32 | `readProbabilityLine` agrees with a probe scan on every 3.3a case | A | n/a | |
| T33 | `writeProbabilityLine`: prepend, insert after block, change, clear, clamp; bytes unchanged elsewhere | A | n/a | |
| T34 | Read-only for several lines, a fallback, an unreadable value | A | n/a | |
| T35 | Differing values: both shown; neither control writes the other's source | A | n/a | risu entry v2 |
| T36 | A probability commit never coalesces with content typing; held text flushed first | A | n/a | |
| T37 | D6 for a truthy value: one step, undo restores both; not offered for `0` or with a line | A | n/a | |
| T38 | Restore line (MC-4008, N4): cases below | A | n/a | |
| T39 | Case sensitive on a classic entry: on, undo, redo, undo, then undo an earlier edit; canonical JSON equals the original | A | n/a | `addLorebook` entry |
| T40 | Moves of an entry whose id another shares succeed; undo of deleting one of two sharers succeeds, also after the other was re-IDed; redo after an outside third holder is refused | A | n/a | |
| T41 | Folder delete (MC-4009): asks with the right `n` and `f`, focus on Cancel; Cancel writes nothing; confirm is one step; empty folder does not ask | A | n/a | |
| T42 | App-wide gates (MC-4043): bulk pair, LorePlus switch, Always active in this chat show exactly when their flag is on; no Studio action writes the five app-wide settings | A | n/a | |
| T43 | All or nothing (N2): a move redo whose `objRemove` passes and `objInsert` fails (outside third holder) writes nothing and leaves both stacks; a D6 undo whose content op fails leaves `activationPercent`; a folder-delete undo with one broken anchor inserts nothing; a step already in place moves as `already`; undo of Add folder after an outside insert shifted it, or after an outside rename, is `precondition`, and no redo writes a second row with its key (review 3 S1(a)) | A | n/a | |
| T44 | Revert (N2): across a lore step changed elsewhere and a set step, nothing is written; a set-only revert behaves as before (C part); a range with an asset merge `lore/` text and a lore step is refused with `studioLoreRevertMixed`; undo of a revert step whose obj half fails is `precondition` and writes nothing, set half included | A / C | set-only part passes before and after | |
| T45 | Undo and restore (N1): delete an id-less folder subtree, restore from History, Undo drops the step with no duplicate key or entry; undo the restore, then Undo of the delete works; a revert across the delete and the restore leaves D unlisted; restore after the delete step left `done` applies the counts; delete a folder, re-import the same export, then Restore from History and Undo of the delete are both refused (`studioLoreRestoreIdTaken`, `precondition`) with no duplicate key (review 3 S1(b)) | A | n/a | classic entries without id |
| T46 | Migration (N3): Studio import of a CC v2 book into a character, an edit, `characterFormatUpdate`, then undo of the edit and of the import both succeed and the bytes equal the migrated form; a duplicate of a classic v1 entry is migrated; a classic-added entry with plain content, edited in Studio, still undoes after `characterFormatUpdate`; a chat import stays verbatim | A | n/a | CC v2 book; `addLorebook` entry |
| T47 | Clear in a fallback chain (N5): `@@keep_activate_after_match` / `@@probability 50` / `@@@depth 0`: Clear writes `@@probability 100`, and a probe scan shows `@@@depth 0` not run before and after; without a following fallback Clear removes the line | A | n/a | probe scan |
| T48 | Three coalesced `objSet` keystrokes, then undo and redo succeed (E1) | A | n/a | |
| T49 | Import skips and counts non-object elements (E6); an empty-string id counts as none (E7) | A | n/a | risu file with `null` elements |
| T50 | Generated histories (property test, below) | A | n/a | `fast-check`, as `history/tests/historyModel.conservation.property.test.ts` |
| T51 | Identity instances (4.0): (a) a folder row holding an id (from an imported file), deleted; a classic verbatim import of a file holding the same key on a folder without that id; Undo (`precondition`) and Restore from History (`studioLoreRestoreIdTaken`) are both refused by `folderKey` alone; (b) Give new ID, export, undo, re-import, redo refused; Give new ID is one remove + insert step; the parser refuses `objSet` on `id`, the planner `objSet key` on a `mode: 'folder'` row, an empty-key one included; (c) delete an id-less classic entry, Undo, reload keeping the data save but not the history save: Undo again writes no second copy and moves as `already`, consuming D | A | n/a | classic entries; a risu file whose folder row carries an id, and one holding the same folder key without it, imported by classic `importLoreBook` |
| T52 | `counts` holds exactly the entry's identity kinds on every insert, remove and item element; the parser refuses a missing or extra kind; `LORE_FIELDS` is frozen without `id` | A | n/a | |
| T53 | Journal tail-merge (R9): (a) 500 `objSet` writes into one 25,000-character `content` field, each more than `COALESCE_MS` apart on a fake clock, leave one lore journal entry while the record holds 100 steps; the line reads `n` = 1, and choosing it restores the visit-start bytes; (b) the same 500 writes within `COALESCE_MS`: one entry; (c) type, then header Undo of that step: the entry nets out and is removed, so a lorebook-only visit shows no line; Redo: one entry again; (d) a `loreSettings` number written 50 times more than `COALESCE_MS` apart: one entry; (e) an outside change to another field of the row between two writes: two entries, and the line is refused with `studioLoreRestoreChanged`; (f) writes alternating between two fields of one row, and between one field of two rows: one entry per run, and the line restores every field; (g) after writes more than `COALESCE_MS` apart have merged in the journal, every recorded step's op is unchanged (deep-equal to a copy taken at its commit), and an Undo of the first of those steps restores that step's own `before`, not the journal's merged value (the deep-equal clause is the one that kills M71); (h) a History revert across one lore field step and one `loreSettings` step, then a one-field write, then the line: the line restores both the field and `loreSettings` | A | n/a; M58 and M59 are the proof that it fails without the tail-merge | `addLorebook` entry with a 25,000-character two-byte content |
| T54 | Totality (R1): a character list built by classic `importLoreBook` from a risu file whose `data` is `[entryA, null, "x", 5, [], entryB]`: an insert (counts skip the non-objects), a remove of index 0 and an `objSet` on `entryB` plan and apply; an `objSet` or remove aimed at a non-object element refuses; a list holding a cyclic object and a bigint refuses a plan touching them and throws nowhere | A | n/a | classic `importLoreBook`; the cycle and bigint rows are synthetic (no producer writes them) |
| T55 | Kind acceptance (R3, R6), with `objectLists.ts` replaced by a table adding a `probe` list held by `character` only: `parseOwnerRecord`, called directly on records whose `ownerKey` is rewritten, one shape per record, accepts a `probe` op and item on a character record and refuses each whole on chat and module records; `isOpAllowedFor` agrees for every (list, kind) pair; a `propSet loreSettings` on a chat or module record is refused whole; lore ops and items parse on all three kinds; a session kind whose spec names `probe` is admitted by `isOpAllowedFor` | A | n/a | replaced table module (`sessionKinds.ts` precedent); records written by the S7 service, then rewritten |
| T56 | Fields and unknown names (R2, R8): the S7 parser refuses whole a record with `list: 'regex'`, one with `objSet` field `flag` on `lore`, and one with an unknown label field; with the replaced table, `objSet` field `x` parses on `probe` and `comment` does not; two `probe` rows differing only in `bookVersion` have different anchors while `lore` still ignores it (T9) | A | n/a | as T55 |
| T57 | Worker path (R7): an owner record holding an `objInsert` whose entry has an unknown key shaped `{had: true, value: 1}`, an own `__proto__` key (from `JSON.parse`) and nesting deeper than 8, and an `objSet` whose value is such an object, diffed by `diffEntry` against its previous record and applied by `applyEdits`, comes back deep-equal with the own `__proto__` key kept | C | may pass before and after: the protocol exists at `71882fe16`; this guards the new payloads | records written by the S7 service |
| T58 | Per-list lines and mixed revert (R4, R5), with the replaced table: a visit editing `lore` and `probe` on one character shows two lines, each with its row's keys; an outside change to `probe` refuses only the probe line, with its row's refusal key, while the lore line and the field writes apply; a revert range holding obj ops and an asset-merge `textEdit` under `probe/` is refused with `probe`'s mixed-revert key; with S7's table alone every lore wording is unchanged | A | n/a | as T55 |
| T59 | Non-entry rows (MC-4081, jsdom): the lorebook list of a character whose list is `[entryA, null, "x", entryB]` renders two inert rows carrying the `studioLoreNonEntryRow` marker, with no row menu, no selection into a form and no op, and after any edit to `entryA` or `entryB` the two elements are still present unchanged at their places; on the same list a deep link by `entryB`'s id opens `entryB`, and a bulk always-active toggle changes only the two entries, without throwing | A | n/a | as T54 |

T38 cases: (a) a lorebook-only visit stores an empty-fields point, shows only the line with the journal count, and reverts it; (b) after an edit in this visit created the point, an undo of an earlier visit's lorebook step is reverted by the line too; (c) no lore path in the restore record; (d) an outside change makes the line revert nothing with `studioLoreRestoreChanged`, while field writes proceed; (e) a delete and a restore from History in the visit return entries and the item listing to the visit start; (f) a new visit starts with an empty journal; (g) a lorebook-only visit after a visit with a field edit replaces that point: no field rows, and Confirm reverts only the lorebook; (h) an owner with no earlier point shows the section after a lore edit; (i) after a reload an earlier visit's empty point is not offered, and an earlier visit's field point shows its rows, no line and the D8 note; (j) a replay-only visit creates no point and shows no line; (k) after the line applies the journal is empty, and an Undo of its step shows the line again with `n` = 1; (l) an asset step creates no point (C part, passes before and after).

**T50** follows advisor F. Generators: lists in classic shapes mixing id-less rows, exact twins, shared ids, folder rows with and without an id, nested folders and child links. Actions: every builder of 2.5; outside edits (insert, delete, reorder, a field rewrite, a verbatim append of an earlier export); undo; redo; revert to a random step; restore from History; the restore line; a reload that drops either the last history save or the last data save. After every action it asserts I1 (a refused action leaves the list, stacks and listing byte-equal), I2 (after every Studio plan, for every `id` and `folderKey`, and for `content` when the plan holds no `objSet`: holders after it ≤ the larger of holders before it and the highest count an applied insert recorded for it), I3 (every applied remove or set found its recorded anchor) and I4 (after an `already` move, checked without `planObjStep`: for each row the step's direction would add, a canonical-equal row is at its recorded index, and for each row it would remove, the live holder count of each of its identities is below the recorded count); with no outside action and no dropped save, undoing every step returns the initial bytes, redoing every step the final bytes, and, while fewer than `MAX_DELETED` items were listed, choosing the line returns the visit-start bytes (which also checks the tail-merge).

A shrunk counterexample becomes a pinned case. CI runs a fixed seed; the run count is set at Gate 2 (10.1).

### 9.1 Mutants to kill

| Mutant | Rule it breaks | Test |
|---|---|---|
| M1: `objSet` skips the anchor check | changed elsewhere | T10 |
| M2: `objInsert` ignores the `id` count | no added id holders | T12, T40 |
| M3: Duplicate keeps the source id | fresh id | T13 |
| M4: Redo generates an id | stable identity | T12 |
| M5: Created entries lack version 2 | no rewrite on load | T13, T14 |
| M6: Folder delete takes direct children only | subtree delete | T15 |
| M7: Move out writes `folder: ''` | upstream shape | T16 |
| M8: Folder move moves only the folder row | contiguous block | T17 |
| M9: The anchor hashes unsorted JSON | key-order independence | T9 |
| M10: The obj item carries `value` and `index` | v2 refusal | T5, T6 |
| M11: A boundary flag skips `loreExt` | settings parity | T23 |
| M12: Deep link takes the first of shared ids | ambiguity → list | T3 |
| M13: No per-module offset | correct index | T1 |
| M14: No W2 after a blank line | block rule | T28 |
| M15: A field edit rebuilds from known keys | unknown fields kept | T19 |
| M16: Collisions checked against the target only | within-file collisions | T25a |
| M17: Single-pass remap | children before their folder | T25b |
| M18: Remap rewrites live entries | live untouched | T25b |
| M19: Reading takes the first of several lines | read-only | T34 |
| M20: Reading includes a line after a blank line | block rule | T32 |
| M21: Writing always prepends | insert after block | T33 |
| M22: A control edit also sets `activationPercent` | separate sources | T35 |
| M23: Coalescing keys on the op field | separate steps | T36 |
| M24: The restore point snapshots the lorebook | no snapshot | T38 |
| M25: The new-id fix re-IDs every sharer | one entry per fix | T30 |
| M26: The folder key lacks U+F000 | upstream key | T13, T25b |
| M27: Case sensitive keeps the container on undo | exact undo | T39 |
| M28: An "id taken" check runs on moves | moves of sharers | T40 |
| M29: The journal ignores replays | restore line covers replays | T38 |
| M30: Read-only gated on `'migrate'` | editable module | T14, T22 |
| M31: The non-empty folder confirm is skipped | MC-4009 | T41 |
| M32: A move lands at a raw array neighbour | 2.6 | T17a |
| M33: D6 offered for `0` | truthy only | T37 |
| M34: The bulk pair shows without `bulkEnabling` | app-wide gate | T42 |
| M35: Obj ops go through the per-op skip loop | all or nothing | T43 |
| M36: One item per remove op (first element only) | one item per delete | T15, T45 |
| M37: A tagged insert ignores whether D is listed | undo and restore exclude each other | T45 |
| M38: Import keeps the imported `bookVersion` | migrate at import | T46 |
| M39: The anchor includes `bookVersion` | stamp-only migration passes | T46, T9 |
| M40: Clear removes the line regardless | fallback chain kept | T47 |
| M41: `mergeCoalesced` keeps the last `anchorBefore` | coalesced undo | T48 |
| M42: The revert's obj part skips failing steps | whole-revert refusal | T44 |
| M43: The count rule is "exactly" on insert | undo after the sharer was re-IDed | T40 |
| M44: The `content` count is ignored | I2 for id-less rows | T50, T51 (c) |
| M45: The `folderKey` count is ignored | I2 for folder rows | T43, T45 |
| M46: A folder row holding an id is counted by `id` only | identities are a set | T51 (a) |
| M47: `already` granted when the opposite plan's inserts are checked by range only | I4 witness | T43 |
| M48: The planner or parser accepts `objSet` on `id` | identity changes only by remove + insert | T51 (b) |
| M49: The planner accepts `objSet key` on a `mode: 'folder'` row whose key is empty | same | T51 (b) |
| M50: The zero-write early return is kept for obj commits | point creation | T38 (g), (h) |
| M51: An earlier visit's empty point is offered | visibility table | T38 (i) |
| M52: The journal is not reset when the line applies | E2(a) | T38 (k) |
| M53: The tag rule is checked per op | per-run rule | T15, T45 |
| M54: A mixed step takes `dropStep` or `already` | conservative mixed step | T44 |
| M55: The witness plan runs with the tag rule | unfinished-save `already` | T51 (c) |
| M56: An asset or replay commit creates a point | replays create none | T38 (j), (l) |
| M57: The parser accepts `counts` with other kinds than the entry holds | counts shape | T52 |
| M58: The journal appends one entry per plan (no tail-merge) | R9 bound | T53 (a), (b) |
| M59: The tail-merge applies only within `COALESCE_MS` (per-step coalescing) | R9: merge whatever the pause | T53 (a), (d) |
| M60: The tail-merge ignores anchor continuity | changed elsewhere | T53 (e) |
| M61: The tail-merge ignores the field or the index | net ops per row and field | T53 (f) |
| M62: A netted-out entry is kept | `n` counts real changes | T53 (c) |
| M71: The tail-merge rewrites the last entry's op in place | the record shares the journal's op objects | T53 (g) |
| M63: The anchor or the count scan treats a non-object element as an object | totality (R1) | T54 |
| M64: Kind acceptance per owner kind, ignoring `OBJ_LIST_HOLDERS` | R3 | T55 |
| M65: The parser checks `LORE_FIELDS` for every list | R2 | T56 |
| M66: An unknown list name parses as `lore` | R8 | T56 |
| M67: Every list's anchor excludes `bookVersion` | per-list anchor | T56 |
| M68: One joint plan for every list's line | per-list lines | T58 |
| M69: The mixed-revert check looks only at `lore/` | R5 | T58 |
| M70: `isOpAllowedFor` ignores session specs | R6 | T55 |

## 10. Build stages

One fresh coder per stage, serial in one worktree.

| Stage | Content | Expected files | Gate 2 |
|---|---|---|---|
| S7-0 | Op family, the per-list tables and their rules (4.1a), anchors, identity counts, `planObjStep` and its routing from `planReplay`/`planRevert`/restore, the per-run tag rule, the `already` witness, `mergeCoalesced`, labels, host writers, the per-list visit journal and its tail-merge, the point creation rule and visibility table, `lorePlus` registry rows, version comment; T50, T53 to T58 | `history/objectListOps.ts` (new), `history/objectLists.ts` (new, tables only), `historyModel.ts`, `fieldRegistry.ts`, `studioHistoryStore.ts` (comment), `ownerHistory.svelte.ts`, `edit/studioSetters.ts`, tests | **opus** |
| S7-4 | Decorator table, block parser, autocomplete, warnings, `readProbabilityLine`/`writeProbabilityLine` | `process/loreDecoratorTable.ts`, `studio/longText/loreDecorators.ts`, `LongTextField` wiring | **opus** (stored content rewrite) |
| S7-1 | List, forms, list ops and landing, row toggle, folder delete confirm, duplicate-id fix, probability pair, D6, selection, tree fix, local activation, the restore sheet's lorebook line and D8 note | `StudioLoreList.svelte`, `StudioLoreForm.svelte`, `StudioLoreFolderForm.svelte` (new), `StudioDetail.svelte`, `StudioRestoreSheet.svelte`, `edit/loreListOps.ts` (new), `ownerModel.ts`, `en.ts` + 7 locales | **opus** |
| S7-2 | Settings panel | `StudioLoreSettings.svelte`, `edit/loreSettingsOps.ts` | Sonnet |
| S7-3 | Import (several files) and export, extractions, collisions, `migrateLoreEntryToV2` extraction | `process/lorebook.svelte.ts` (extraction), `characters.ts` (extraction), `edit/loreImport.ts` | **opus** |
| S7-5 | Deep link by id, index fix | `process/loreUse.ts`, `process/lorebook.svelte.ts`, `process/modules.ts`, `chatShell/openLoreEntry.ts`, `studioTarget.ts`, `studioScreen.svelte.ts` | Sonnet |

Order: S7-0, S7-4, S7-1, S7-3; S7-2 and S7-5 any time after S7-0. A PR carrying several stages gets one opus Gate 2.

### 10.1 What the opus Gate 2 carries

Accepted deferrals for the round 4 brief (advisor G). None changes a stored shape or a product promise, and a named test decides each:
- the tag rule's run boundaries and order inside a plan beyond T15, T45 and T50 (review 3 E1);
- the line's count (plans or steps; whether to show a number) and the refusal note when `MAX_DELETED` evicted an item the line needs (review 3 E2(b), 4.4);
- mixed-step corner cases beyond the conservative rule (4.2, 11);
- the cost of `content` counts and of large folder deletes on the Note 9 (anchor and cheap-field pre-filter), and T50's run count;
- Restore from History index clamping details;
- carried from r4: chat-host writes reaching the saved chat unit (S7-0), the sheet committing the line with the field writes in one step (S7-1), the 2 MiB keep-walk limitation (3.6);
- a further replay-identity instance: first ask whether T50 as specified finds it; if so, it is a Gate 2 finding;
- **journal memory (R9), measured on the real service, not a model:** 500 writes more than `COALESCE_MS` apart into one 25,000-character field keep one entry and about two field values; alternating between two fields 200 times stays within a memory budget the build states. Only if the second run exceeds it does the maintainer get the conditional question whether a line may be withdrawn past a limit with a "cannot be reverted" note (inside MC-4008 for lore; for regex it would amend MC-4051). No cap is added before that;
- the `already` listing wording (review 4 ruling): D is listed only from the step's own tagged ops, and an existing D is not rebuilt (4.2; T51 (c), M55).

This spec keeps: the `counts` shape and `LORE_FIELDS` (stored format), I1 to I5, the `already` definition, the creation rule and visibility table, the per-list tables' `lore` row, the tail-merge and its bound, T50 to T58 and the pinned cases.

## 11. Risks and trade-offs

- **Per-entry anchors and identity counts, not a whole-list fingerprint.** Local, and cheap with a pre-filter (10.1). An insert has no anchor, so an undone delete can land at a shifted index; it never overwrites.
- **All or nothing** makes Undo stop at a lore step changed elsewhere, as a fingerprinted greeting step does today; History's single-step undo and the refusal notes are the way past it.
- **History size.** A step or item over the owner cap stops the keep walk and drops it and every older stored entry. A folder delete stores its subtree twice (ops and item).
- **The visit journal** adds no stored data. With the tail-merge its memory follows row, field and prop switches and list operations, not keystrokes or pauses (4.6). It has no count cap; the build measures it (10.1).
- **Stuck mixed step (known limitation):** a revert or restore-point step whose obj half no longer applies stays as `precondition`; header Undo stops at it, and History single-step undo goes past.
- **More than 50 listed items (known limitation):** for an evicted item the line refuses with `studioLoreRestoreChanged`, header Undo of its delete takes `dropStep`, and a revert across it is refused whole (4.4).
- **Classic and Studio both editing:** no lock; anchors protect replays, not live overwrites.
- **Upstream file touches:** three extractions, the index fix and `entryId`.
- **D4** differs from classic; a dangling link is inert (`lorebook.svelte.ts:507-511`).
- **Two probability sources (MC-4006)** can disagree; both are shown, never reconciled automatically.
- **A re-IDed imported link (MC-4004)** points at no parent.

## 12. Design defaults (confirmed, MC-4080)

The maintainer confirmed every default below (MC-4080); none is open.

- **D1:** A new entry starts with an empty name, focus on the name, `alwaysActive: false` everywhere (classic: `New Lore N`, module `New Lore`, add-in-folder `true`, `LoreBookData.svelte:226`).
- **D2:** `lorePlus` hides nothing.
- **D3:** Reorder by row menu and Alt+↑/↓. Drag-and-drop reorder in the windowed list is follow-up #718.
- **D4:** Deleting a character entry keeps its chat child links.
- **D5:** Entries whose folder is missing show at top level, with a fix.
- **D6:** "Move into @@probability" for a truthy legacy value when no line exists.
- **D7:** Studio import and duplicate into a character or module list run the version migration inside the step (2.4). The resulting bytes equal what the next selection or load produces.
- **D8:** An earlier visit's restore point shows a fixed note, `studioLoreRestoreEarlierVisit`, that lorebook changes since then are not undone there; only this visit's point carries the lorebook line (4.6).

## 13. Product decisions (resolved 2026-11-23)

| Decision | Where it lands |
|---|---|
| **MC-4004:** fresh ids and keys only on collision, with a notice | 2.3, 3.6, T25a, T25b, M16 to M18 |
| **MC-4005:** mark shared ids, offer a new id | 2.5, 3.2, 3.3, 3.9, T30, M25 |
| **MC-4006:** both the legacy field and the `@@probability` control | 3.3a, 3.7, 4.2, 4.3, T32 to T37, T47, M19 to M23, M33, M40 |
| **MC-4007:** open by id even if moved or renamed | 6, T2 to T4 |
| **MC-4008:** no snapshot; revert this visit's lorebook changes | 4.6, D8, T38, M24, M29, M50 to M52, M56 |
| **MC-4009:** non-empty folder delete confirms once with a count; empty does not ask; one step. Imported id-less entries get an id. | 3.4, 2.3, 3.6, T41, T25a, M31 |
| **MC-4030:** feature complete against classic; link-out only as an interim with a follow-up | 1.1, 1.2 |
| **MC-4043:** app-wide settings stay in Settings; per-item fields in Studio | 0, 1.2, 3.5, T42, M34 |
| **MC-4080:** D1 to D8 confirmed; drag-and-drop reorder is follow-up #718 | 0, 1, 1.2, 3.2, 12 |

Coordination with #687: **O1:** S7-4 and #687 share `loreDecoratorTable.ts` and its block parser. **O2:** whether the shared-identity count runs over eligible entries only (5.1).

## 14. Premises

| Premise | Status |
|---|---|
| Entry shape and hosts; group `loreSettings` (`database.svelte.ts:1440-1461`, `:1476`, `:1669`, `:2010`; `modules.ts:48`) | INHERITED from r3 (reopened there) |
| Folder shape and U+F000 prefix (`lorebook.svelte.ts:147`, `:160`; `ModuleMenu.svelte:137`) | INHERITED from r3 |
| Classic UI paths; 12 files for the 1.2 regex under `src/lib`, tests excluded | REOPENED (Grep, r4) |
| `planReplay` and `planRevert` apply op by op with skip, `kept`, `already`, `dropStep` (`historyModel.ts:1474-1694`, `:1849-2068`); `plainUndo` exclusion (`:1530-1540`) | REOPENED |
| `producedItems` keeps the first item per id; `deletedEntryFor` falls back to the op (`:2583-2621`) | REOPENED |
| `applyReplayMove` keeps `step.at` (`:2728`); `mergeCoalesced` handles only `set`/`listSet` (`:2645-2658`) | REOPENED |
| `updateLorebooks` per-entry rule, in place (`characters.ts:1088-1103`); callers of `characterFormatUpdate` (`characters.ts:2021`, `:2027`, `group.ts:35`, `coldMemberRestore.ts:53`, `playgroundChat.ts:65`, `homeStudio.svelte.ts:174`); module migration at boot (`bootstrap.ts:709`) and stub load (`moduleLoader.ts:141`) | REOPENED |
| ccardlib 0.4.2 `Ce`: initial state "not ignored"; each named `@@` line sets state to (handler returned false); `@@@` runs only on that state; `@@@end` normalised; a non-`@@` line ends the block | REOPENED (extracted from `dist/index.js`) |
| `probability` handler returns `undefined` and blocks on `roll × 100 > parseInt(arg)` (`lorebook.svelte.ts:744-750`) | REOPENED |
| `getModuleLorebooks` joins a non-array `lorebook` as one element with no owner (`modules.ts:959-976`); `usedEntryOf` module index (`lorebook.svelte.ts:213-224`) | REOPENED |
| Decorator returns, `priority` NaN, `position` throw (`lorebook.svelte.ts:563-588`, `:632`, `:752-754`, `:889`) | INHERITED from r3 |
| Repair need answers (`moduleLorebookRepair.ts:50-58`) | INHERITED from r3 |
| v2 strict parse and keep walk (`historyModel.ts`, `studioHistoryStore.ts:475-477`, `:613-687`) | INHERITED from r3 |
| ChroMemory eligibility excludes folder, child and constant modes (`chromemory-spec.md:363`); whether the identity count does is not stated there | REOPENED |
| `visitId` is new per `openStudio` (`studioScreen.svelte.ts:47`, `:182`) | INHERITED from review 2 |
| `noteRestoreWrites` returns the point unchanged on zero writes; a field edit passes `replaces: true`, an asset step, replay, revert or restore `false` (`historyModel.ts:2528-2564`, `:2777`; `ownerHistory.svelte.ts:896`, `:947`, `:1008`) | REOPENED (r5) |
| The panel shows the section only `{#if view.restore}`; the sheet lists `restore.fields` and Confirm is `disabled={!restore}` (`StudioHistoryPanel.svelte:293`; `StudioRestoreSheet.svelte:34`, `:37`, `:111`) | REOPENED (r5) |
| A folder row is `mode === 'folder'` with a non-empty string key (`lorebookFolders.ts:13`, `:20`) | REOPENED (r5) |
| Classic import appends verbatim (`lorebook.svelte.ts:1003-1038`), so a folder row may carry an id | INHERITED from r4 (1.2) |
| Asset rows carry an equality `count` per op; `holdsResultOf` is false for `listInsert`; revert undoes every step above its target (`historyModel.ts:151-156`, `:1172-1208`, `:1846-1862`) | INHERITED from advisor-1 and review 3 |
| The restore sheet can carry a lorebook line and commit it with the field writes as one step | INHERITED (SLICE1 §5); S7-1's opus Gate 2 confirms |
| Chat-host writes reach the saved chat unit | INHERITED; S7-0's opus Gate 2 confirms |
| The windower serves a nested list | INHERITED (MC-3399 build) |
| MC-4030 and MC-4043 wording | INHERITED from the coordinator's relay (`Agents/mc/682.md`, PR pending; not read) |
| MC-4080 wording (`Agents/mc/685.md`) | REOPENED (r6) |
| `COALESCE_MS` 1000 and `MAX_DONE` 100 (`historyModel.ts:18-19`); `commitStep` merges only into the open step within `COALESCE_MS` and caps `done` (`:2661-2710`); `mergeCoalesced` (`:2645-2658`) | REOPENED (r6) |
| A commit passes the builder's op array to `commitStep`, which stores it as the step's `ops` by reference (`ownerHistory.svelte.ts:944`, `historyModel.ts:2684`) | REOPENED (r6) |
| A long-text field commits on every non-composing input event (`longText/fieldWrite.ts:95-106`, write at `:84`) | REOPENED (r6) |
| `isOpAllowedFor` decides per owner kind only (`historyModel.ts:354-371`) | REOPENED (r6) |
| `sessionKinds.ts` is a pure data table that a test may replace (its header comment); `sessionAdapterOf` (`sessionAdapters.ts:33`) | REOPENED (r6) |
| `diffEntry`, `applyEdits` (`studioStoreProtocol.ts:163-174`, `:212`); `diffNode` treats field-value-shaped objects and `__proto__` specially (`:130-159`) | REOPENED (r6) |
| Classic `importLoreBook` pushes a risu file's elements verbatim (`lorebook.svelte.ts:1019-1023`) | REOPENED (r6) |
| The scan's chat-state identity is `id ?? pickHashRand(5555, content)` (`lorebook.svelte.ts:564`, `:577`, `:855`, `:858`) | REOPENED (r6) |
| MC-4050 settles non-object and malformed regex rows only (`Agents/mc/684.md` in the #684 worktree); MC-4081 gives lore the same treatment | REOPENED (r6); settled by MC-4081 |
| The asset merge also writes `textEdit regex/<i>/out` (`referenceTargets.ts:299-302`) | INHERITED from #684 seam-fit |
| Per-keystroke journal growth (#684 review 4, S6; its Node model was not re-run) | INHERITED from #684 review 4 and advisor-2 |

## 15. How r3 answered review 1

Review 2 accepted every r3 answer (F1 to F7, E1 to E15, `objMove` not adopted). Revision 4 changes three of them: E10's trimmed rule and E14's merge stop are withdrawn, because the journal (4.6) makes both unnecessary; F4's empty-fields restore point is withdrawn for the same reason; revision 5 narrows that to F4's counting half and reinstates its creation half (4.6, 17). F3's `idCount` rule changes from "exactly" to "at most" on insert, with no count check on remove (4.2).

## 16. How r4 answered review 2

Review 3 accepted every r4 answer (N1 to N5, E1 to E11, the simpler path) and r4's changes to E10, E14 and F3. It did not accept F4's withdrawal (S2, answered in 17). The full table is in r4.

## 17. How r5 answers review 3 and the advisor

Revision 5 is a delta on r4 under the advisor's binding direction (`advisor-1.md`). `planObjStep`, the tag rule, D7, the anchor and the journal stay; no accepted answer is withdrawn whole.

| Finding | Disposition | Answer |
|---|---|---|
| S1 folder rows lack identity | ADDRESSED as a class | Invariants I1 to I5 and the closure table (4.0). Every row holds a set of identities: an id, a folder key, or its content when it holds neither. Every insert, remove and item element carries a count per identity under r4's accepted "at most" rule (4.1, 4.2). An identity changes only by remove + insert: `id` leaves `LORE_FIELDS`, and the planner refuses `objSet` on a folder row's `key` (2.5, 4.1). `already` needs a witness (4.2). Both of review 3's traces now refuse: in (a) the opposite insert would add a second holder of K; in (b) the restore and the undo meet K held by the import. The reviewer's narrower wording ("an id, else a folder key") leaves three instances, each now pinned: a folder row holding an id (T51a), Give new ID over a re-import (T51b), an id-less row after an unfinished save (T51c). T43, T45, T50 to T52; M44 to M49, M55, M57. |
| S2 restore point | ADDRESSED | F4's creation half returns for edit commits with obj or `propSet` ops; replays and asset steps create none (4.6). The visibility table also covers what the reviewer's fix leaves open: an earlier visit's empty point after a reload is not offered, and a replay-only visit shows no line. T38 (a), (b) restated, (g) to (l); M50 to M52, M56. |
| E1 tag rule per run | ADDRESSED | Per-run wording (4.2). Mixed steps take the conservative row: the obj half gates, with no `already` and no `dropStep`; the stuck step is a known limitation (11). T15, T44, T45; M53, M54. |
| E2(a) journal after the line | ADDRESSED | The journal resets when the line applies (4.6). T38 (k); M52. |
| E2(b) evicted items | Gate 2 item | Stated as a known limitation (4.4, 11); the note's wording goes to the opus Gate 2 (10.1). |
| Simpler path | ADOPTED, widened as the advisor directs | One identity count for every row; F4's creation rule. |

**Advisor direction:** A (freeze) is kept; B → 4.0; C → 4.1 (`OBJ_LIST_IDENTITY`, required `counts`), 2.5 and 8 (`studioLoreRestoreIdTaken` reworded); D → 4.2; E → 4.6 and D8 (12); F → T50 to T52 and the closure table (4.0); G → 10.1.
- **Designer choice within D:** the witness plan runs without the tag rule, so after an unfinished history save the step moves and its listing is corrected instead of sticking (M55). A reviewer may prefer the stricter reading (witness with tags; the step then sticks as `precondition`); both satisfy I2.
- **Investigation 1:** a folder row can carry an id (classic import appends verbatim; 3.6 keeps a free id), so the identity set is required. **Investigation 2:** only Give new ID and local activation write `id` (2.5); both become remove + insert.
- **Changes to accepted answers:** r4's `idCount` (F3, N1) becomes `counts.id` with the same rule; `objSet id` becomes remove + insert of the same row at the same index; section 15's withdrawal of F4 is narrowed to its counting half; section 16 is shortened to its outcome.

## 18. How r6 answers review 4, MC-4080 and #684 R1-R9

Revision 6 is bounded. The r5 mechanism and the advisor's direction (`advisor-1.md`) stand, and no accepted answer is withdrawn.

| Input | Item | Disposition | Where |
|---|---|---|---|
| Review 4 | E1 `content` identity against the scan | ADDRESSED | 4.1 (the whole row, not the scan's identity); 2.1 (`id: ''` is an id to the scan; #687, O2) |
| Review 4 | E2 `objSet key` keyed on `mode` | ADDRESSED | 4.0 closure table, 4.1, 4.2; T51 (b) and M49 take an empty-key folder row |
| Review 4 | E3 T50's I4 oracle | ADDRESSED | T50: rows and holder counts checked directly, without `planObjStep` |
| Review 4 | E4 I2 wording | ADDRESSED | 4.0 I2 |
| Review 4 | E5 eviction also affects Undo and revert | ADDRESSED | 4.4, 11 |
| Review 4 | Ruling on the tagless witness; its wording condition | ADDRESSED | 4.2 `already`; 10.1 |
| MC-4080 | D1 to D8 confirmed; D3's drag is #718 | ADDRESSED | 0, 1, 1.2, 3.2, 12, 13 |
| #684 R1 | Totality over non-object elements | ADDRESSED | 4.1a, 4.2; T54, M63; Q1 below |
| #684 R2 | Per-list field table, per-list anchor exclusion | ADDRESSED | 4.1, 4.1a, 4.3; T56, M65, M67 |
| #684 R3 | Acceptance per (list, kind) | ADDRESSED, test adapted | 4.1a, 7.1; T55, M64 |
| #684 R4 | Per-list journal and lines | ADDRESSED, with #684 review 4 E-m and E-n | 4.1a keys, 4.6; T58, M68 |
| #684 R5 | Mixed revert over every obj list prefix | ADDRESSED | 4.2; T58, M69 |
| #684 R6 | Session-kind holders; S7 adds no row | ADDRESSED | 4.1a; T55, M70 |
| #684 R7 | Worker protocol test | ADDRESSED | 4.1a; T57 |
| #684 R8 | Unknown names refuse the record whole | ADDRESSED | 4.1a, 7.2 (d); T56, M66 |
| #684 R9 | Journal memory, a finding against S7 | ADDRESSED with advisor-2's tail-merge | 4.6, 10.1, 11; T53, M58 to M62 |
| #684 round 5 V-1 (coordinator) | The tail-merge builds a new op; the record shares op objects | ADDRESSED | 4.6; T53 (g), M71 |

Where r6's wording departs from a request, the request's semantics are kept:
- **R3, R4, R5 tests.** S7 has one list, and every stored kind holds `lore`, so lore data alone cannot tell per-(list, kind) acceptance from per-kind acceptance, nor per-list lines from one line. The tables sit in a pure data module that T55, T56 and T58 replace with a `probe` row, as tests may already replace `sessionKinds.ts`. The regex rows' own tests stay with S6 (seam-fit rows 6 and 17).
- **R2.** `LORE_FIELDS` keeps its name as the `lore` row. r5 did not say which lore fields accept `{had:false}`; r6 says all of them, which a stored row lacking a key needs. No r5 shape changes.
- **R4.** Each list's line plans on its own: a refused list stays as it is while the other lines and the field writes proceed, as the lore refusal already does (#684 review 4 E-n). The count-refusal and mixed-revert keys come from the list's row (E-m).
- **R5.** As requested: "any obj list's prefix", not only the prefix of a list whose obj ops are in the range. In a build with only S7 this is r5's `lore/` rule.
- **R6.** No S7 test shows a session holder end to end; T55 checks only that Rule K reads the session spec. S6c owns the preset adapter test.
- **R9.** The merge is per plan: a plan whose entry on a list (list ops and that list's prop ops together) is exactly one `objSet` (or one `propSet`) merges into a one-op tail entry, and any other plan appends one entry. Advisor-2 sketched the merge per op; typing is always a one-op plan, so the bound is the same, and `n` stays a count of entries. A netted-out entry is removed (the choice advisor-2 asked the seam to state), so `n` never counts a change that was undone. `propSet` merges too, so typing in the settings numbers is bounded as well. No cap and no product question (advisor-2, "Do not"); the measurement is 10.1's build item, and only its result can raise the conditional question.

**Q1 (resolved by MC-4081).** R1 makes the seam total. The maintainer chose the regex treatment of MC-4050 for lore: S7's lorebook list shows a live element that is not an object (`null`, a string, a number or an array, from classic `importLoreBook`) as an inert row with a marker and no ops, its data untouched. A repair action is follow-up #720. It affects S7-1's rows only; S7-0 does not wait for it. The marker's key `studioLoreNonEntryRow` is in section 8, and T59 pins the row.