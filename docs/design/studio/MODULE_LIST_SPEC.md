# Studio: module list operations (#709)

Status: **spec, revision 3 (editorial only)** (2026-11-24; Gate 1 r3 [EDITORIAL], section 10d), **built in PR 750** (as-built notes: [MODULE_LIST_SPEC_AMENDMENT_3_4.md](MODULE_LIST_SPEC_AMENDMENT_3_4.md) and `Agents/stages/709/STAGE_HANDOFF.md`). Spec first (MC-3902), so no build starts before this file merges. The four product questions are answered (section 10). Ticket yor42/RisuTanium#709, filed from #683 (S5) under MC-3985. Written against `origin/main` 2099bea7a. Builds on [MODULE_ADVANCED_SPEC.md](MODULE_ADVANCED_SPEC.md) (S5) sections 0, 1.3, 3 and 6, and on the Studio shell of [SLICE1_SPEC.md](SLICE1_SPEC.md).

**Build amendment (2026-11-24).** The L1 build found that section 3.4 was wrong about teardown writes: a Studio form must not write from `onDestroy`. [MODULE_LIST_SPEC_AMENDMENT_3_4.md](MODULE_LIST_SPEC_AMENDMENT_3_4.md) replaces sections 3.4 and 3.5 contract 2, rows F4 and F10 of section 6, T9-GONE-DELETE in section 8, amends T5-NSCOMMIT, and adds L-F (section 9) and the premises of section 11. Where the two differ, the amendment wins. How the amendment was checked: revisions 1 and 2 each got an opus check and both were [REJECT]; revision 3 was never checked as text and was read through Gate 2 (a [REJECT] on one test gap, fixed). T9-EXPORT-COMPAT (a `.risum` byte-equality row) was not built: both surfaces call the same `exportModuleRow` over unchanged exporters.

Decisions used: MC-058, MC-175, MC-223, MC-329, MC-350, MC-774, MC-912, MC-1639, MC-1827, MC-2576, MC-3638, MC-3896, MC-3900, MC-3902, MC-3982, MC-3984, MC-3985, MC-4030, MC-4043, MC-4044, MC-4070, MC-4120. Every ID except MC-4120 has a row in `Agents/Decision-Index.md` and an entry in `Agents/Maintainer-Context.md` (checked 2026-11-24). MC-4120 is not folded yet; it is in `Agents/mc/709.md`, as MC-3044 allows.

**No product question is open (section 10 records the four answers and the accepted MCP limitation, MC-4120).** Every other choice marked **(design default)** was made here inside decided intent and can be vetoed without asking the maintainer. One design default extends MC-3896 to modules on the brief's instruction (section 3.4); section 12 names it so the orchestrator can confirm it.

**What revision 2 changes (Gate 1 r2 [REJECT], section 10c):**
- T9-MCP-URL gains the R case `stdio:{"url":"http://localhost@evil.invalid/"}` and a mutant row, so an inner URL checked by text prefix fails (R2-1). Both URL paths go through one `admitHttpUrl` (design default).
- T9-WITHDRAW-ORDER's probe only records what it sees. The test asserts after `importModule()` resolves, asserts that the probe ran once, and asserts that the replace landed, because `importModuleFile` catches every throw, a failing `expect` inside the probe included (R2-2).
- T9-MCP-URL observes through `alertError` and the mocked `MCPClient` constructor instead of `getMCPMeta`, which `importMCPModule` calls through a binding inside `mcp.ts`; a direct unit test of `admitMcpImportUrl` is added (R2-3). `http://[::1]:9/` is relabelled R (R2-4).
- The withdraw no longer advances the publish token, and the equivalent mutant row for it is dropped (R2-5).

**What revision 1 changes (Gate 1 r1 [REJECT], section 10b):**
- The MCP import admission also reads a `stdio:` value through `parseMcpUrl`, so a `stdio-url` inner URL passes the same host rule. The host comes from a URL parse, so a userinfo URL such as `http://localhost@evil.invalid/` is rejected. New R cases and mutants (F1).
- The admission is stated as a check on the explicit Import MCP prompt only. MCP modules from files, plugins and restores keep today's run-time rule, an accepted known limitation recorded with MC-4120 (F2).
- T9-WITHDRAW-ORDER names its observation seam: a probe in `describeReplace`, which `commitModule` calls synchronously after the withdraw (F3).
- The conversion ask reads the acquired body, with a stub case and a mutant; classic gains the ask through the shared helper, and the spec says so and tests it (F4, F6).
- Smaller corrections: the section 0 replace row, a plugin-write limitation, test setups, reused keys and test paths, a non-string name guard in the shared search, build details, records wording, and a grilling note (F5, F7-F11).

**Summary.**
- Studio gets one fixed tree entry, **Module list**, whose detail page holds every classic list operation: create, import a file, import an MCP module, a name search over every module (stubs included), a windowed list, and per row: on in all chats, export (CharX or legacy `.risum`), make a character, delete, open in Studio.
- The list operations become shared helpers in `src/ts/process/moduleListOps.ts`. The classic Modules page calls the same helpers, so the two never drift.
- A module that is deleted or replaced by an import while a Studio form shows it clears the selection with `studioRefusalModuleGone`, and held typing is dropped (MC-3896 applied to modules). A replace withdraws the published open-module id in the same synchronous block as the slot write, so no held text lands on the replaced content.
- **No stage edits `src/ts/studio/history/fieldRegistry.ts`, `historyModel.ts`, `ownerHistory.svelte.ts` or `src/ts/studio/edit/studioSetters.ts`** (section 3.3).
- No stored format changes (`.bin`, `.risum`, `.charx`, store2, the Studio history store).

## 0. Today (source read in this worktree)

| Fact | Anchor (`src/`) |
|---|---|
| Classic lists `db.modules` in array order, filtered by a case-insensitive name search, windowed with `WindowedSegment`. A row key is `['m', id, occurrence]`, so a search never changes a key and two rows sharing an id get different keys. | `lib/Setting/Pages/Module/ModuleSettings.svelte:36-48, 76-82`; `moduleListWindow.ts:9-31` |
| The search reads `(module?.name ?? '').toLowerCase()`, so a module whose `name` is a non-string value (a number from an MCP server, for example) makes it throw. | `moduleListWindow.ts:22-30`; `process/mcp/mcp.ts:591` |
| A row shows an MCP icon when `rmodule.mcp` is truthy, the name, and the description or `settingsPage.noDescriptionProvided`. | `ModuleSettings.svelte:90-94, 228-230` |
| **Enable globally** toggles the id in `db.enabledModules` (`push`, or `splice` of the first occurrence), then reassigns the array. The amber "on through Module Integration" state is shown when the id is not enabled and the module's **namespace** is in `db.moduleIntergration` split on commas and trimmed; it is exposed as `aria-describedby` with `moduleOnByIntegration`. | `ModuleSettings.svelte:117-142` |
| The engine selects a module by **id or** non-empty namespace in every reference source, the integration string included. Classic's amber rule reads the namespace only. | `process/moduleRefs.ts:23-47` |
| **Export** asks CharX (recommended) or RisuM (Legacy) with a cancel, acquires the row (`useModuleRow`), calls `exportModule` or `exportModuleLegacy`, and releases in `finally`. | `ModuleSettings.svelte:144-168` |
| An MCP row has export and edit **disabled**. Delete and enable globally stay. | `ModuleSettings.svelte:143, 197-204` |
| **Delete** confirms `removeConfirm + name`, finds the clicked row by reference after the confirm (a row that left the list is a no-op), splices it, and removes the id from `enabledModules` only when no remaining row holds that id. It never acquires a stub. A test pins this. | `ModuleSettings.svelte:205-223`; `ModuleSettings.deleteTarget.svelte.test.ts` |
| **Create** pushes `{name: '', description: '', id: v4()}` into `db.modules` at once, then opens the editor. Its "Create Module" button only closes the editor; there is no cancel, and leaving the page keeps the blank module. | `ModuleSettings.svelte:238-246, 265-273` |
| **Make a character** is a mode toggle that swaps each row's buttons for one convert button. It acquires the row, pushes `convertModuleToCharacter(module)` into `db.characters`, releases, shows `successfullyConverted` and calls `checkCharOrder()`. | `ModuleSettings.svelte:96-115, 249-253` |
| `convertModuleToCharacter` **throws** `mcpModuleConversionUnsupported` for an MCP module. Classic's convert handler does not catch it, so on an MCP row the click ends in an unhandled rejection with no message. | `ts/interchangeability.ts:8-13`; `ModuleSettings.svelte:97-109` |
| Conversion copies `lowLevelAccess` (`m.lowLevelAccess \|\| false`), `hideIcon`, `backgroundEmbedding`, assets, namespace, toggles and icon, and deep-copies the result. It drops `risutanium_asset_retained`. | `interchangeability.ts:15-31, 59` |
| **Import** calls `importModule()` (multi-file picker, task card, duplicate questions, low-level confirms, Undo of added modules). **Import MCP** calls `importMCPModule()`. Neither takes an argument nor returns the new module. | `ModuleSettings.svelte:254-263`; `process/modules.ts:879-914`; `process/mcp/mcp.ts:538-613` |
| The classic page calls `refreshModules()` only in `onDestroy`. `getModules()` memoises on the reference id list and the list object, so after a delete of a **referenced** module (the id still in a character, chat or integration list) it keeps returning the deleted row until a refresh. `undoImport` refreshes right after its removal; classic delete does not. | `ModuleSettings.svelte:64-71`; `modules.ts:933-952, 1164-1168`; `importUndo.ts:96-106` |
| `useModuleRow` returns a resident row as it is and acquires a stub by id; a failure shows `moduleLoadFailed(name)` and resolves `null`. | `process/moduleUse.ts:23-33, 70-85` |
| A stub carries its index entry's fields (name, description, id, namespace, `mcp: true` for an MCP module) and the stub marker; an edited stub is never overwritten by the loader. The index entry keeps `lowLevelAccess` **only when it is a boolean**, so a stub of a module holding a truthy non-boolean such as `1` shows no flag. | `storage/store2/moduleStubMatch.ts:12-26`; `storage/store2/codec/modules.ts:53-55`; `process/moduleLoader.ts:151-173` |
| A module deleted while its stub load is in flight is not reinstalled: the loader finds no recorded slot and returns null (or a resident row that moved into the start index, a recorded limit). | `moduleLoader.ts:159-173` |
| The only **import** replace write is `applyModulePlacement` (replace keeps the target's **id** and position), and its only production caller is `commitModule`. In its replace branch `commitModule` calls `applyModulePlacement`, `progress.committed`, `refreshModules()` and `describeReplace` in that order with no await. Other id-keeping slot writes exist: a plugin's full-list write (it can change content), the stub loader (stub to body), Studio's own setter and classic's editor. | `process/moduleDuplicates.ts:50-71`; `modules.ts:673-686` (Grep `applyModulePlacement(`: one non-test caller); `plugins/plugins.svelte.ts:640-641`; `moduleLoader.ts:182`; `ModuleSettings.svelte:281-284` |
| The Studio tree lists active modules under **Modules** and the rest under **Other modules (n)**, each paged by 100, and hides a group with no module. Nothing in Studio creates, deletes, imports, exports, converts or enables a module. | `lib/Studio/StudioTree.svelte:151-189`; `ts/studio/studioScreen.svelte.ts:331` |
| A module owner id is the stored id for the first row holding it and `${id}#${rowIndex}` for a later row. | `ts/studio/ownerModel.ts:410-428`; `ts/studio/assets/openModuleForm.svelte.ts:50-59` |
| The tree's row menu (`studio-row-menu`) has one item, "Open in the classic editor", and is opened from the keyboard only (the `menu` key action). | `StudioTree.svelte:266-281, 324, 362-368` |
| A selected owner that the model no longer has clears the selection with `studioNotFound`. A pinned preset with no or several holders clears with `studioRefusalPresetGone` (MC-3896). | `lib/Studio/StudioDetail.svelte:134-152` |
| The stub link of a module reads `studioOpenModules` and opens Settings at the Modules page through `openInClassicEditor`. Any other module shows `studioOpenClassic` to the same page. | `StudioDetail.svelte:311-317`; `ts/studio/classicLinks.svelte.ts:56-61, 83-96` |
| The history service accepts a module write only while the module's id is the published open-module id; any other id is refused `not-selected`. The detail publishes the id of a loaded, unshared, non-private module and clears it by token. | `ts/studio/edit/studioSetters.ts:78-94`; `openModuleForm.svelte.ts:8-35`; `StudioDetail.svelte:79-96`; `history/studioHistoryService.svelte.ts:133` |
| The S5 form flushes its name composition and its namespace draft in `onDestroy`; a flush writes only while `live` is found and the view is editable. | `lib/Studio/StudioModuleAdvancedForm.svelte:61-68, 93-126, 185-194` |
| Every Studio state function that changes the detail calls `flushStudioFields('leave')` first; `setStudioSelection` does. `clearStudioSelection` does not. | `ts/studio/fieldFlush.ts:6-9`; `studioScreen.svelte.ts:375-389, 412-421` |
| The owner model is a `$derived` over `db.modules` (row ids and namespaces through the lister), so a push is visible to the next read in the same task. `studioScreen.svelte.ts` holds no owner model; `groupPathOf` needs the owner's `active` flag, which `applyStudioTarget` gets from the model it is passed. | `ts/studio/ownerSource.svelte.ts:66-82`; `studioScreen.svelte.ts:449-481` |
| Studio item search skips stubs (a stub is only counted). | `ts/studio/studioSearch.ts:154-175` |
| `db.enabledModules` and `db.moduleIntergration` are root keys deep-read by the generic top-level save effect; module slots and the list shape by the modules effects. | `storage/dbChangeEffects.svelte.ts:195-226, 248-262` |
| History owners are keyed `module:<id>`; nothing deletes an owner's record when its owner is deleted (the store evicts by size). | `history/ownerPhase.ts:16, 40-42`; Grep `forgetOwner\|dropOwner\|deleteOwner\|removeOwner\|discardOwner` in `src/ts`: 0 files |
| Studio and Settings are never open together; global alerts and task cards are app-level, and Studio already shows `alertError` and downloads. | `App.svelte:74-78, 282-286`; `ts/studio/studioToggleLinks.ts:28-43`; `StudioScreen.svelte` (`alertError`); `StudioPresetBiasField.svelte` (`downloadFile`) |

## 1. Scope

### 1.1 In and out

**In (MC-3985, the #709 body and its 2026-11-23 comment):** create, delete, import a module file, import an MCP module, export (CharX and legacy `.risum`), make a character from a module, enable globally with the "on through Module Integration" state, the classic search and windowed list, the stub link `studioOpenModules` (S5 section 1.3, error-state row) and retiring the classic link **as the route for these operations**.

**Out:**
- The trigger and Lua editor (#708). Loaded module kinds keep `studioOpenClassic` as their interim link until #684, #685 and #708 land (S5 section 1.3); after #709 that link no longer carries any list operation.
- The classic Modules page itself stays: classic retirement is not this ticket. It switches to the shared helpers (section 3.1) and gains the consequences listed in section 3.2.
- Per-chat and per-character module choice (`ModuleChatMenu.svelte`, the `thisChat` and `character` badges). #709 does not name it; section 12 asks lane A whether MC-4030 needs a ticket for it.
- Run-time enforcement of the MCP host rule for modules that do not come through the Import MCP prompt (accepted known limitation, section 10).
- Reordering modules (classic has none), a "used by" count in the delete confirm, and bulk operations.
- Preset list management (#710, MC-4044), whose spec is separate.

### 1.2 Operation inventory

| Classic | Where in Studio after #709 | Behaviour | Ticket |
|---|---|---|---|
| Search by name | Module list page, `studio-module-list-search` | Classic's match (`matchingModulePositions`): case-insensitive substring of `name`, stubs included; a non-string name matches nothing instead of throwing | #709 |
| Windowed list | Module list page | `WindowedSegment` with `moduleRowKeys`, as classic | #709 |
| Create | Page toolbar, `studio-module-list-create` | Decided OQ-1 (section 10) | #709 |
| Import a file | Page toolbar, `studio-module-list-import` | `importModule()` unchanged | #709 |
| Import MCP | Page toolbar, `studio-module-list-import-mcp` | `importMCPModule()`; decided OQ-3 (section 10) for its URL check | #709 |
| Enable globally | Row switch, `studio-module-list-global` | Classic's toggle (section 3.2) | #709 |
| On through Module Integration | Row note, `studio-module-list-integrated` | Engine rule: id or namespace (design default, section 3.2) | #709 |
| Export (CharX / RisuM Legacy) | Row menu, `studio-module-list-export` | Classic's flow; disabled with a reason on an MCP row | #709 |
| Make a character | Row menu, `studio-module-list-convert` | Classic's flow; disabled with a reason on an MCP row; decided OQ-4 (section 10) for low-level access | #709 |
| Delete | Row menu, `studio-module-list-delete` | Classic's confirm and removal plus an immediate `refreshModules()`; decided OQ-2 (section 10): no Undo | #709 |
| Edit (opens ModuleMenu) | Row tap opens the module in Studio (`studio-module-list-open`) | Selects the module owner at its 고급 kind; a stub loads as on any selection | S5 and the kind stages |

### 1.3 Classic links after #709 (MC-4030)

| Link | After #709 | Class |
|---|---|---|
| `studioOpenModules` on a stub (`studio-detail-classic`) | **Removed.** A stub module's detail shows `studio-module-show-in-list` (`studioShowInModuleList`), which opens the Module list page at that row. Delete and export of a module that cannot load happen there. | error-state route moves into Studio |
| `studioOpenClassic` on a loaded module, any kind (`studio-detail-classic`) | Kept, as the interim route to the trigger tab only (#708), and until #684 and #685 for regex and lore. A loaded module's detail also shows `studio-module-show-in-list`. | interim, tickets named |
| Tree row menu `studio-row-menu-classic` on module rows | Unchanged (same destination and reason as the row above). | interim |

No classic-only module **list** operation remains after #709.

## 2. Layout

### 2.1 Mount (design default)

- **Tree entry.** A fixed level-1 row labelled `studioModuleList` ("Module list"), rendered by `TreeRow` like every row (`data-part="studio-row"`, row id `l:modules`). It sits directly before the **Modules** group and is present even with no module at all, because the module groups are hidden when empty and create and import must stay reachable. It is a leaf: activating it calls `selectStudioNode(MODULE_LIST_KEY, null, null)`. It has no row menu (its `ownerType` is null).
- **Selection key.** `MODULE_LIST_KEY = 'list:modules'`. `list` is no `StudioOwnerType`, so `parseStudioTarget`, `selectedHistoryOwner` (returns null: no history owner) and the owner model never treat it as an owner. `StudioDetail`'s not-found effect skips it as it skips the combined keys.
- **Detail page.** `StudioDetail` mounts a new `lib/Studio/StudioModuleList.svelte` (`data-part="studio-module-list"`) for that key, in place of the owner header. The title is `studioModuleList`.
- **Why not row actions in the tree:** the tree's row menu is keyboard-only today, a phone needs touch targets, and the tree hides empty groups. **Why not actions on the module owner's own detail:** a delete would remove the page it is shown on, and the list page already gives every operation one place. A module's detail links to its row instead (`studio-module-show-in-list`).
- **Phone (stack layout).** The page is a detail like any other: Back returns to the tree. A row's Open moves to that module's detail; Back from there returns to the tree, not to the list (design default: no `listReturn` for this page, which keeps `StudioListReturn` unchanged).

### 2.2 The page

From top to bottom:
1. Toolbar `studio-module-list-toolbar`: Create (`studio-module-list-create`, label `createModule`), Import (`studio-module-list-import`, label `import`), Import MCP (`studio-module-list-import-mcp`, label `moduleImportMcp`). Buttons are at least 44 px high (`min-h-11`), as other Studio buttons.
2. Search `studio-module-list-search` (label `search`), bound to page-local state that a visit does not keep (design default).
3. The list `studio-module-list-rows` (`role="list"`), or `studio-module-list-empty` (`noModules`) when `db.modules` is empty, or `studio-module-list-no-match` (`studioSearchNoResults`, "No results") when the search hides every row.
4. A polite live region `studio-module-list-status` for results of the page's own operations.

**Row** `studio-module-list-row` (`role="listitem"`), keyed by `moduleRowKeys`:
- Open button `studio-module-list-open`: the MCP icon (`aria-hidden`) when `mcp` is truthy, the name as **text** (an empty or non-string name shows `language.modules`, as MC-4070's fallback), the description or `settingsPage.noDescriptionProvided` below it (a non-string description shows the fallback too), and tags: `studioNotLoaded` for a stub, `studioBadgeAllChats` (through `badgeLabelOf('allChats')`) when enabled globally.
- Switch `studio-module-list-global`: `role="switch"`, `aria-checked` = id in `enabledModules`, label `enableGlobal`. When the row is on through Module Integration and not enabled globally, the hidden `studio-module-list-integrated` (`moduleOnByIntegration`) is its `aria-describedby`, and the switch has the amber `risu-state-amber` look classic uses.
- Menu button `studio-module-list-menu-button` (`aria-haspopup="menu"`, label `studioModuleListActions(name)`) opening `studio-module-list-menu` with Export (`download`), Make a character (`moduleConvertRow`) and Delete (`remove`). On an MCP row Export and Make a character are disabled and the menu shows `studio-module-list-mcp-note` (`studioModuleListMcpOnly`). Esc and Back close the menu and return focus to its button; the build reuses the tree menu's key handling where it fits.

### 2.3 Module owner detail changes

- `studio-module-show-in-list` (`studioShowInModuleList`) on every module owner that is not restricted: stub, loading or loaded, any kind or none. It calls `openStudioModuleList(revealKey)` (section 3.2), which goes through `setStudioSelection`, so held text is flushed first.
- The stub branch of `studio-detail-classic` is removed (section 1.3). A loaded module keeps `studio-detail-classic` with `studioOpenClassic`.

### 2.4 States

| State | Shown |
|---|---|
| No modules | `studio-module-list-empty`; toolbar active |
| Search hides every row | `studio-module-list-no-match` |
| Stub row | Name and description from the stub's entry; `studioNotLoaded` tag; Open loads it through the detail; Export and Make a character acquire it (`useModuleRow`); Delete never acquires |
| MCP row | Icon; Open enabled (MCP modules are editable in Studio, MC-1639); Export and Make a character disabled with the note |
| Non-string name | Shown as `language.modules`; never matches a search (section 3.2) |
| Two rows share an id | Both rows listed with distinct keys; the switch shows the same state on both (one id); Open selects the row's own owner id (`id` or `id#index`), whose forms are read-only (S5) |
| An operation's alert open | The global alert is modal over Studio; nothing else on the page acts |
| A load or export fails | The existing helper's own message (`moduleLoadFailed`, the task card); the page shows no second message |

### 2.5 `data-part` names

Every name is a literal attribute with the `studio-` prefix, in `src/lib/Studio/`, so the theme-pack area guard (`themePack/areaParts.test.ts`) classifies them as Studio parts with no change to that file: `studio-module-list`, `studio-module-list-toolbar`, `studio-module-list-create`, `studio-module-list-import`, `studio-module-list-import-mcp`, `studio-module-list-search`, `studio-module-list-rows`, `studio-module-list-row`, `studio-module-list-open`, `studio-module-list-global`, `studio-module-list-integrated`, `studio-module-list-menu-button`, `studio-module-list-menu`, `studio-module-list-export`, `studio-module-list-convert`, `studio-module-list-delete`, `studio-module-list-mcp-note`, `studio-module-list-empty`, `studio-module-list-no-match`, `studio-module-list-status`, `studio-module-show-in-list`. MC-3638: no new invariant or protected part is added for any of them.

## 3. Write model

### 3.1 Shared helpers (`src/ts/process/moduleListOps.ts`, new)

Each helper is the one implementation of its operation; classic's handlers and Studio's page call it. They take the clicked **row object** (never an index or an id alone), because the list can change while an alert is open.

| Helper | Does | Returns |
|---|---|---|
| `createModule(name: string): RisuModule` | Pushes `{name, description: '', id: v4()}` (classic's shape, MC-329) and returns the pushed slot as read back from `db.modules`. The caller passes the trimmed name. | the slot |
| `removeModuleRow(row): boolean` | After the caller's confirm: `indexOf(row)` by reference; `-1` returns false. Else splice, reassign `db.modules`, remove the id from `enabledModules` when no remaining row holds it (classic's rule), then `refreshModules()` | removed |
| `setModuleGlobal(id, on): void` | Classic's toggle: push, or splice of the first occurrence, then reassign | |
| `exportModuleRow(row, format: 'charx' \| 'risum'): Promise<void>` | Refuses an MCP module (by the resident body or the stub's `mcp` flag) with `alertError(mcpModuleConversionUnsupported)`; `useModuleRow`; `exportModule` or `exportModuleLegacy`; release in `finally` | |
| `convertModuleRow(row): Promise<character \| null>` | `useModuleRow` first. Then, on the **acquired** module (never the clicked row, whose stub may lack a non-boolean flag): if `lowLevelAccess` is truthy, ask `studioModuleListConvertLowLevel(name)` (L-V, L3); Cancel releases and returns null. Then `convertModuleToCharacter` inside `try`; an MCP module (or any throw) shows `alertError` and returns null; on success pushes the character and calls `checkCharOrder()`. Release in `finally` | the character or null |
| `moduleIntegrationState(row, db): 'global' \| 'integration' \| 'off'` | `global` when the id is in `enabledModules`; else `integration` when `matchesModuleRef(row, set of integration strings)`; else `off` | |

The format question (`alertSelect`), the delete confirm and the create name prompt stay in the callers, because each surface owns its own prompts; the wording is classic's in both. The conversion ask lives in the helper, because both surfaces must ask (OQ-4 B).

### 3.2 Operations

**Create (OQ-1 B, decided).** Toolbar Create → `alertInput(studioModuleListCreatePrompt, undefined, '', {cancel: ALERT_INPUT_CANCEL})` (`alert.ts:431`). Cancel creates nothing. A blank answer (empty after `trim()`) creates nothing and says `studioModuleListNameNeeded` in the status region. Otherwise `createModule(answer.trim())` (design default: the stored name is the trimmed answer), then `openStudioModuleOwner(model, slot, 'advanced')`:
- the caller passes the current owner model from its `ownerSourceFor` source, read **after** the push (the model is a `$derived` over `db.modules`, so the read returns the rebuilt model with the new owner);
- `openStudioModuleOwner` (in `studioScreen.svelte.ts`) finds the owner by key in that model, expands the group path `groupPathOf(owner)` gives (`otherModules` for a new module, which nothing references) and the owner row, as `applyStudioTarget` does, then calls `selectStudioNode(owner.key, 'advanced', null)`;
- no `studioNotFound` notice appears (T9-CREATE pins it);
- the S5 form mounts and history begins empty for the new id.
The module is not enabled anywhere, as classic.

**Delete (OQ-2 A, decided).** Row menu Delete → `alertConfirm(removeConfirm + name)` (classic's text). Yes → `removeModuleRow(row)`; on `true` the status region says `studioModuleListDeleted(name)`. The page is the selection, so no form of the deleted module is mounted. Its history record stays in the device store until evicted (inherited, as for a deleted character); its stdio approval, if any, stays in `consent/mcp-stdio-approvals.json` (keyed by an id that a later import never reuses; a backup restore of the same module finds it approved again, as before).

**Enable globally.** The switch calls `setModuleGlobal(row.id, !on)`. Shared ids switch together (one id). The owner moves between the **Modules** and **Other modules** groups on the model's next derive; the selection key does not change (the key is `module:<id>`), so nothing is cleared.
- **Design default: the integration state follows the engine** (`matchesModuleRef`: id or namespace), not classic's namespace-only rule. Classic shows a module whose **id** is listed in Module Integration as off although the engine turns it on. The classic page switches to `moduleIntegrationState` too, which fixes that display (T9-GLOBAL-CLASSIC).

**Export.** Row menu Export → `alertSelect(['CharX (' + recommended + ')', alerts.risumLegacy], undefined, {cancel: ALERT_SELECT_CANCEL})` (classic's question) → `exportModuleRow(row, format)`. Everything after the choice is the existing export: CharX preflight and size refusal, the save dialog, the task card, `.risum` asset records (section 5).

**Make a character (OQ-4 B, decided).** Row menu Make a character → `convertModuleRow(row)`. On a character: the status region says `successfullyConverted`. The new character is not selected (Studio stays bound to its character).

**Import a file / Import MCP.** The buttons call `importModule()` and `importMCPModule()` exactly as classic. Their own cards and alerts report the outcome; the page lists new rows as `db.modules` changes. A new MCP module is not enabled (as classic). The Import MCP prompt's URL admission changes in L3 (section 4).

**Search.** `matchingModulePositions` (shared with classic) reads a name only when it is a string: `typeof module?.name === 'string' ? module.name : ''`. A non-string name matches only the empty search, and neither page throws (T9-SEARCH-NAME). This is a one-line change in `moduleListWindow.ts` and fixes classic too.

**Open and Show in list.**
- Row Open → `openStudioModuleOwner(model, row, 'advanced')`, with the page's current model.
- `studio-module-show-in-list` → `openStudioModuleList(revealKey)`: `setStudioSelection(MODULE_LIST_KEY, null, null)` (flushes held text), then sets `studioScreen.revealListRow` to the row's `moduleRowKeys` key (after the selection, which clears it), then `pickStudioItem()`. The page clears its search, scrolls the row into view (the window host's reveal) and focuses its Open button once, then clears `revealListRow`. Design default: reuse of `revealListRow`, whose comment widens from "merged list" to "the list the detail shows".

**Flush before an operation.** Every operation starts on the list page, which is reached through `setStudioSelection`, so held text of a module form has been written before any export or conversion reads the module (T9-FLUSH-EXPORT).

**Classic page consequences** (it calls the same helpers):
- its convert catches the MCP throw and shows the message (T9-CONVERT-MCP-CLASSIC);
- its convert **asks before making a character from a module with Low Level Access on**, with the same key `studioModuleListConvertLowLevel` (OQ-4 B applies to classic through the shared helper, L3; T9-CONVERT-CLASSIC-ASK);
- its delete refreshes `getModules` at once instead of at page close (T9-REFRESH);
- its amber state reads id or namespace (T9-GLOBAL-CLASSIC);
- its search no longer throws on a non-string name (T9-SEARCH-NAME).
Its other behaviour is pinned by the existing classic suites (section 8).

### 3.3 History: list operations stay outside the history core

**Explicit statement for lane A: no #709 stage edits `src/ts/studio/history/fieldRegistry.ts`, `src/ts/studio/history/historyModel.ts`, `src/ts/studio/history/ownerHistory.svelte.ts` or `src/ts/studio/edit/studioSetters.ts`.** The stages touch `src/ts/studio/assets/openModuleForm.svelte.ts` and `src/ts/studio/studioScreen.svelte.ts`, which are not history-core files. (Gate 1 r1 checked this claim against source and found it true.)

Why this is sound:
- The history model records field ops **of one owner** against that owner's live object, with preconditions read from it (`resolveModuleTarget` requires the slot). Create and delete add or remove the owner itself, so neither can be an op of the owner it creates or removes. Recording them would need a new owner-list kind, a new stored record shape (an MC-1827 widening) and a restore of a whole module, which is the data-loss surface this design avoids.
- `enabledModules` and `moduleIntergration` are app-level settings, not fields of any owner's registry row. MC-4043 keeps app-wide settings outside the forms; enable globally is a list toggle that its own switch reverses at once.
- Import has its own Undo for added modules (`undoImport`, MC-2576); a replace is not undoable there, by design.
- Conversion writes a new character that has no Studio history yet.

Consequences, all inherited behaviour that this spec only names:
- Delete is not undoable in Studio's history (OQ-2: no separate Undo, decided).
- A deleted module's history record stays in the device store until evicted. A step of it can never land: the owner's id is no longer published, so every replay is refused (`studioSetters.ts:78-94`).
- After an import replace the module keeps its id, so its history survives and S5's low-level guard asks on every off→on replay (MC-3984). That is unchanged.

### 3.4 A module deleted or replaced while Studio shows it (MC-3896 applied to modules; design default on the brief's instruction)

MC-3896 decided for presets: "The selection clears, with the notice `studioRefusalPresetGone`. Typing since the last write is dropped, and no preset changes. A write refused because the preset is gone shows the same text." This spec applies the same rule to a module owner.

**Delete from outside the page** (a task card's import Undo, a plugin write, a restore that replaces the database):
- The owner leaves the model. `StudioDetail`'s not-found effect clears the selection with `studioRefusalModuleGone` when the key is a module key (today `studioNotFound`), and keeps `studioNotFound` for every other owner type.
- Held typing is dropped without a change: the form's unmount flush finds no slot, so `live` is undefined, `editable` is false and nothing is written (`StudioModuleAdvancedForm.svelte:61-68, 185-194`); held long text is dropped by the field's dispose on unmount. A history replay is refused because the id is no longer published.
- **Wording edge (accepted):** a later row of a shared id has the owner id `id#index`. When an outside removal of an earlier row shifts its index, its key no longer resolves, and the notice reads "That module is no longer available." although the module still exists under a new key. Shared-id rows are read-only in Studio (S5), so nothing is lost; the user selects the row again.

**Replace by an import** (the duplicate question answered Replace, possibly while a backgrounded import card runs):
- The id stays, so the owner stays in the model and today's form stays mounted on the new content. A held namespace draft or name composition would then flush **onto the replaced module** when the user leaves, which MC-3896 forbids.
- Change: `openModuleForm.svelte.ts` gains `withdrawOpenModuleId(id: string): void`. When `id` is the published id it sets the published id to null and records `withdrawn = id` (reactive). It leaves the publish token alone: the detail's later teardown clear, made with its own token, only sets an already-null id to null, and every later publish follows that teardown (Gate 1 r2 R2-5). Only a new selection publishes again. `withdrawn` is reset to null by the detail when it clears the selection, and by every `publishOpenModuleId` of an id other than the withdrawn one, so a stale value cannot clear a later selection; `resetOpenModuleIdForTests` resets it too (Gate 1 r3 E4).
- `commitModule` calls `withdrawOpenModuleId(placement.previous.id)` in its replace branch, **right after `applyModulePlacement` returns `replaced`, in the same synchronous block, and before `describeReplace`** (before or after the synchronous `refreshModules()` is not observable and is not pinned). Every module form's later write, flush included, is refused `not-selected` by the existing check (`studioSetters.ts:79-80`), so the held text is dropped and nothing lands on the new content. The refusal shows only in the form's own refusal line, never over the Studio notice.
- `StudioDetail` reads `withdrawn`: when it equals the selected module's raw id it calls `clearStudioSelection(language.studioRefusalModuleGone)` and resets `withdrawn`. The publish effect does not re-run on a replace (it reads only `openableModuleId` and `moduleIdShared`, which a replace keeps), so it cannot publish again before the clear.
- A replace of **another** module withdraws nothing (the id is not the published one).
- The module's history survives (keyed by id). Selecting the module again publishes it again.

Covered forms: every Studio form that writes a module through the history service (S5 고급 and 배경 HTML, the module toggle builder, the module asset form), because all of them depend on the published id. Update-All's `textSet` path has no held typing.

Not covered (inherited, named):
- A `.rtb` or `.bin` restore that replaces the whole database is the restore flow's own business.
- **A plugin's full-list write that keeps the id but changes the content** (`plugins.svelte.ts:640-641`) is not an import replace and withdraws nothing, so held typing can still flush onto plugin-replaced content. MC-3896 names delete, import and `.rtb` restore, not plugin writes. Known limitation; a plugin write that removes the module is covered as a delete.

### 3.5 Changed critical contracts (Gate 2: opus-reviewer)

1. **Module list removal (persisted module list and `enabledModules`).** One helper now removes a module for both surfaces, and it calls `refreshModules()` at once. Failure scenarios: the wrong row is removed (by id instead of reference, or after a reorder during the confirm); the id leaves `enabledModules` while another row holds it; the deleted module keeps feeding prompts through the `getModules` memo; a stub is acquired (or written) just to be deleted. Store2's handling of a removed module unit is unchanged and inherited from classic.
2. **Studio write acceptance after a replace.** The published open-module id is withdrawn by the import commit. Failure scenarios: held typing lands on replaced content; the withdraw clears another module's publication; it happens after an await or in a microtask, so a flush slips in between.
3. **(L3) MCP URL admission at the explicit Import MCP prompt** (classic and Studio; gates.md Gate sequence item 4, MC-912). It is the one check on that prompt, **not** a network boundary for MCP traffic as a whole. MCP modules that arrive through a module file (`importModuleJson` stores a `risuModule` with its `mcp` key, `modules.ts:811-831`; a `.risum` keeps the scanned module, `modules.ts:485-508`), a plugin write (`plugins.svelte.ts:640-641`) or a restore keep today's run-time rule: `getModuleMcpEntries` hands their `mcp.url` to the client layer (`modules.ts:1038-1049`) and `createMCPClient` admits any `http://` (`mcp.ts:276-281`). That residual is an **accepted known limitation** (maintainer, 2026-11-24, recorded with MC-4120). Failure scenarios inside the contract: a `stdio:` value with a `url` key carries a non-loopback `http://` URL past the prompt; a userinfo URL is read by its text prefix; a valid loopback or https URL is refused.
4. **(L3) The low-level confirm on conversion**, a security enforcement input, on both surfaces. Failure scenarios: no ask; an ask that reads the clicked stub row (which lacks a non-boolean flag) instead of the acquired body; a Cancel that still pushes a character.

Unchanged: `.bin`, `.risum`, `.charx` and store2 shapes; the Studio history record format; the field registry; the module stub and loader contracts.

## 4. MCP module import (traced, security-relevant)

`importMCPModule()` (`process/mcp/mcp.ts:538-613`), unchanged by L1 and L2:

1. **Asks** `alerts.mcpEnterModuleUrl` with an input and eleven suggestions (six `internal:` clients and five third-party https servers); Cancel ends with nothing (`:539-555`).
2. **Checks** the text by prefix: `http://localhost`, `http://127`, `https:`, `internal:`, `stdio:` or `plugin:`; anything else shows `errors.invalidUrl` (`:557-567`). The prefix check accepts plain `http://` to hosts such as `localhost.example` or `127.example`, and userinfo URLs such as `http://localhost@evil.invalid/` (host `evil.invalid`). Any `stdio:` value passes it.
3. **Clears** an earlier OAuth decline for that URL so the explicit import asks again (`:570-575`).
4. **Connects** through `getMCPMeta([url], undefined, owners)` with a fresh module id as the owner (`:576`):
   - `internal:*`: an in-app client; `internal:fs` can ask for a directory (`mcp.ts:53-57`);
   - `plugin:*`: a client a plugin registered;
   - `stdio:` is read by `parseMcpUrl` (`stdioSpec.ts:21-60`): a JSON body with a truthy `url` key is **`stdio-url`**, and `createMCPClient` then uses that inner URL as the client URL (`mcp.ts:172-177`), which needs only `startsWith('http://')` or `'https://'` (`:276-281`). The spawn refusal applies only to `stdio-spawn`, so the `stdio-url` form works on Android and web too. Today `stdio:{"url":"http://192.0.2.1/mcp"}` therefore reaches a plain-HTTP non-loopback server from this prompt;
   - `stdio:` naming a program (**`stdio-spawn`**): refused before any prompt outside the desktop app ("stdio MCPs are only supported in the desktop app" on Android, "... in Local Version" on web; `:109-114, 181-184`), which surfaces as `alertError(<that message>)` (`:610-611`); on desktop `admitStdio` asks `formatStdioConsent(url, spec)` and persists an approval keyed by the new module id and the spec hash in the byte-store key `consent/mcp-stdio-approvals.json`, never in the database or a module file (`stdioApproval.ts:7-8, 116-167`);
   - `http(s)`: `MCPClient` handshake (`:274-291`); a server that needs OAuth makes the client ask `alerts.mcpOAuthHelperConsent` naming the server host and the helper host before any helper contact; a refresh token is pushed into `db.authRefreshes` (stored in the database and so in `.bin`) (`mcplib.ts:680-717`; `mcp.ts:263-272`).
5. **Outcomes:**
   - OAuth declined → silent, nothing stored (`:580-583`);
   - no metadata (network failure, stdio not admitted, handshake failure) → `errors.mcpModuleNotFound` (`:584-588`);
   - any throw → `alertError(error)` (`:610-612`);
   - success → `alertNormal(mcpModuleImported{name})` (`:608`).
6. **Stores** one module pushed onto `db.modules` (`:590-607`):
   - `name`: `serverInfo.name` (server-controlled; may be any JSON type);
   - `description`: `"MCP from " + url` (the URL may carry a token or name a private host, `modules.ts:143-144`);
   - `mcp: {url}` and the new `id`;
   - one **always-active** lorebook entry `@@mcp` with the server's name, version and `instructions`. That server-controlled text enters every prompt in which the module is active.
   The client stays registered in the live client table until swept (5-minute idle guard, `mcp.ts:58`).

**L3 replaces step 2 (OQ-3 B, MC-4120).** A new pure export `admitMcpImportUrl(text: string): boolean` in `mcp.ts`, called where the prefix check is today; a refusal shows `errors.invalidUrl` as today:
1. `internal:` or `plugin:` prefix → admitted, as today.
2. `stdio:` prefix → `parseMcpUrl(text)`:
   - `stdio-spawn` and `stdio-invalid` → admitted, as today (the spawn is refused outside the desktop app and asks consent on it; an invalid body fails later with its reason);
   - `stdio-url` → admitted only when the inner `url` is a string that passes rule 3. A non-string `url` is refused.
3. Anything else, and every `stdio-url` inner URL, goes through one helper, `admitHttpUrl(url: string): boolean` (design default: one function for both paths, so they cannot diverge). It parses with `new URL(url)`; a throw refuses. The scheme and host are read **only from the parsed URL**, never by text prefix or by splitting the string:
   - `https:` → admitted;
   - `http:` → admitted only when `hostname` is `localhost`, an IPv4 address whose first octet is `127` (the parser normalises short forms such as `127.1`), or `[::1]`; any port;
   - any other scheme or host → refused.
   So `http://localhost@evil.invalid/` and `http://127.0.0.1@evil.invalid/` (host `evil.invalid`) are refused, and so are `stdio:{"url":"http://evil.invalid/"}` and `stdio:{"url":"http://localhost@evil.invalid/"}`.

**Display in Studio.** The page renders name and description as text interpolation only, never as markup (T9-NAME-TEXT). The URL is visible in the description, as in classic and the S5 form. No new display of `instructions` (OQ-3 C, not chosen, would have added one).

**Export, conversion and upload refuse an MCP module** (`modules.ts:145-148`; `interchangeability.ts:11-13`; `moduleUse.ts:51-56`); Studio disables both menu items with a reason instead of offering an action that fails. A full backup carries the module (`modules.ts:143-144`).

**Inherited limits (named, not changed):**
- **The host rule gates only the explicit Import MCP prompt** (classic and Studio). An MCP module that arrives in a module file, through a plugin write or in a restore keeps today's run-time rule, under which `createMCPClient` admits any `http://` URL (`mcp.ts:276-281`). Accepted known limitation (maintainer, 2026-11-24, with MC-4120); enforcing the rule at run time would refuse existing LAN `http://` MCP modules and is not part of #709.
- A deleted MCP module's live client, and on desktop its stdio child process, keeps running until the idle sweep.
- An import that fails after a stdio approval leaves the approval for an id no module holds (harmless: ids are never reused).

## 5. Import and export compatibility (MC-175, MC-223, MC-774)

- **Import** is `importModule()` unchanged: `.risum`, `.charx` (through the card importer and `convertCharacterToModule`), `.json` (a `risuModule`, a risu lorebook, an external lorebook, a regex list) and `.lorebook` (`modules.ts:653-666, 742-870`). Each gets a fresh `id`, `risutanium_asset_retained` is dropped from the file (`modules.ts:183-186, 649, 821-822`), a truthy `lowLevelAccess` asks first (`modules.ts:772, 824-830`; `characterCards.ts:1747-1749`), a stub-marker key is refused (`modules.ts:812-814`), and duplicates by trimmed name ask Replace, Skip or Add (`moduleDuplicates.ts:6-26`). Upstream → fork keeps working because nothing in this path changes.
- **Export** is the existing `exportModule` (CharX v3 card of the converted module with its preflight, size refusal and task card) and `exportModuleLegacy` (`.risum` with asset records). The only fork-only fields are `risutanium_asset_folders`, carried verbatim and ignored by upstream as an unknown key, and `risutanium_asset_retained`, device state that a module file never carries (`modules.ts:61-67, 183-195`; `interchangeability.ts:27-31`). Neither is user data that upstream could hold, so MC-223's named-omission warning does not apply, and #709 adds no new omission. Oversize assets are refused before the save dialog by the existing preflight, as today.
- **Create** writes classic's shape and **conversion** writes classic's character, so `.bin` round trips are unchanged (MC-175).
- **MC-350:** no stored format changes, so no migration.

## 6. Security and data-loss failure scenarios

| # | Scenario | Prevented by | Test |
|---|---|---|---|
| F1 | Delete removes another row: the list reorders while the confirm is open, or two rows share the id | reference lookup after the confirm (`removeModuleRow`) | T9-DELETE, classic `deleteTarget` suite |
| F2 | A deleted, still-referenced module keeps feeding prompts | `refreshModules()` inside `removeModuleRow` | T9-REFRESH |
| F3 | Deleting an unloaded module acquires or writes its stub | the helper never calls `useModuleRow` | T9-DELETE (stub case) |
| F4 | Held typing lands on a module an import just replaced | `withdrawOpenModuleId` in the commit's synchronous block | T9-GONE-REPLACE, T9-WITHDRAW-ORDER |
| F5 | The withdraw hits the wrong module, so its open form silently refuses writes | withdraw only when the id is the published one | T9-WITHDRAW-SCOPE |
| F6 | Export or conversion misses text the user just typed | every operation starts from the list page, reached through `setStudioSelection`'s flush | T9-FLUSH-EXPORT |
| F7 | An MCP module's URL (token, private host) leaves the device through Studio | export and convert refuse MCP in the helper as well as in the menu | T9-EXPORT (MCP), T9-CONVERT (MCP) |
| F8 | A server-controlled MCP name or description runs as markup in Studio | text rendering only | T9-NAME-TEXT |
| F9 | A stub acquired for export or conversion is never released | `finally` in the helper | T9-EXPORT (throw case) |
| F10 | Held typing of a module that an outside delete removed is written somewhere | the unmount flush finds no slot; a replay finds no published id | T9-GONE-DELETE |
| F11 | **At the Import MCP prompt**, plain HTTP to a non-loopback host passes the "local" prefix, a userinfo URL, or a `stdio:` value with a `url` key | `admitMcpImportUrl` (OQ-3 B): URL parse, `stdio-url` inner URL checked by the same rule. **Not prevented** for modules from files, plugins or restores (accepted known limitation, section 4) | T9-MCP-URL |
| F12 | Conversion silently produces a character with Low Level Access on, including from a stub whose entry lacks a non-boolean flag | OQ-4 B ask on the acquired body, on both surfaces | T9-CONVERT (low-level and stub cases), T9-CONVERT-CLASSIC-ASK |
| F13 | The list key is taken for a vanished owner and cleared | not-found effect skips `MODULE_LIST_KEY` | T9-LIST-ROWS |
| F14 | A non-string module name makes the list search throw, and the page breaks | string guard in `matchingModulePositions` | T9-SEARCH-NAME |

## 7. en.ts keys (English only)

**Reused:** `modules`, `noModules`, `createModule`, `import`, `moduleImportMcp`, `search`, `enableGlobal`, `moduleOnByIntegration`, `moduleConvertRow`, `remove`, `removeConfirm`, `download` (the export item's label, as classic), `recommended`, `alerts.risumLegacy`, `settingsPage.noDescriptionProvided`, `successfullyConverted`, `errors.mcpModuleConversionUnsupported`, `errors.invalidUrl`, `studioNotLoaded`, `studioBadgeAllChats` ("All chats", through `badgeLabelOf`), `studioSearchNoResults` ("No results"), `studioRefusalModuleGone`, `studioOpenClassic`, `cancel`.

**New: 8** (5 for the page, 2 for Create under OQ-1 B, 1 for the conversion ask under OQ-4 B). The build PR carries all 7 other locales from the translator and passes `localeParity` (MC-058).

| Key | English | Where |
|---|---|---|
| `studioModuleList` | Module list | tree entry and page title |
| `studioShowInModuleList` | Show in module list | module owner detail |
| `studioModuleListActions` | (name: string) => `More for "${name}"` | row menu button label |
| `studioModuleListMcpOnly` | MCP modules stay on this device, so they cannot be exported or made into a character. | row menu note |
| `studioModuleListDeleted` | (name: string) => `Removed "${name}".` | status region |
| `studioModuleListCreatePrompt` | Name of the new module | create prompt (OQ-1 B) |
| `studioModuleListNameNeeded` | Give the module a name to create it. | status region (OQ-1 B) |
| `studioModuleListConvertLowLevel` | (name: string) => `"${name}" has Low Level Access on, and the new character will too. It can use AI models and your storage directly. Make the character?` | convert confirm on both surfaces (OQ-4 B) |

`studioOpenModules` loses its only caller (`StudioDetail.svelte`). Design default: remove it from all 8 locale files in the same locale batch, with the three tests that assert it amended (section 8). OQ-3 C was not chosen, so no confirm keys are added for it.

## 8. Required tests

**Labels** (gates.md; lane A's 2026-11-24 ruling for S5: a new-behaviour row that fails on the pre-change base is R): **R** = regression reproducer, failing on an assertion about the intended defect or missing behaviour on the named base (import, setup and missing-export failures do not count); **C** = compatibility guard, may pass before and after (each row says so); **D** = diagnostic.

**Pre-fix base:** `origin/main` 2099bea7a unless a row names a stage-internal base. Every R row is **DESIGNED, NOT DEMONSTRATED** until the build shows its pre-fix failure. **R rows are written against surfaces that exist on the base** (the classic page, `StudioDetail`, `StudioTree`, `importModule()`, `importMCPModule()`, `moduleListWindow.ts`, the history service), so they fail on an assertion there. A helper-level unit test of `moduleListOps.ts` is the fast form of the same scenario; its evidence is the mutant table, and its label follows its surface row.

**Fixtures (MC-329), each built the way its producer builds it:**
- *classic-created:* through `createModule` and, for the classic comparison, the classic Create button: `{name, description: '', id}`;
- *imported:* a `.json` `risuModule` file fed to `importModule()` with `selectFileByDom` mocked, and a `.risum` from `exportModuleLegacy(module, {saveData: false})` of a classic-created module with one asset;
- *replace-imported:* the same `.json` file whose `name` equals an installed module's, with the duplicate question (`alertSelect`) answered Replace, so `commitModule` → `applyModulePlacement` runs;
- *MCP:* `importMCPModule()` with `alertInput` answering `internal:dice` and `getMCPMeta` mocked to return `{serverInfo: {name, version}, instructions}`, so the pushed module has the real shape; a hand-built `{mcp: {url}}` is not used;
- *stub:* `moduleStubOf(entry)` from a store2 module index entry (`moduleStubMatch.ts:22-26`), as the boot path mints it. For the low-level stub case the entry is encoded by the store2 module codec from a body holding `lowLevelAccess: 1`, so the entry (and the stub) has no flag while the acquired body does (`codec/modules.ts:53-55`);
- *shared id:* two installed modules with one id, placed as a store2 load of a `.bin` with a duplicated row would place it (the build names the producer; if none produces it, the row says so and uses a hand-built pair).
No network: every MCP test mocks the client layer; URL cases use `*.invalid` hosts.

| Id | Scenario | Class | Base and expected failure | File (new or extended) |
|---|---|---|---|---|
| T9-TREE | With zero modules, the tree has a row with `data-row-id="l:modules"` before any module group; activating it selects `list:modules`, and on a phone moves to the detail | R | `origin/main`: no element with that row id | `StudioTree.svelte.test.ts` |
| T9-LIST-ROWS | Selecting `list:modules` mounts `studio-module-list`; rows follow `db.modules` order with stub, MCP and shared-id rows; an empty or non-string name shows `language.modules`; description fallback; the search filters by name, ignoring case, stubs included; `studio-module-list-no-match` shows `studioSearchNoResults` when nothing matches; a row's DOM node is kept across a search (keys from `moduleRowKeys`); the selection is not cleared and no notice appears | R | `origin/main`: the not-found effect clears the unknown key with `studioNotFound`, so `studio-module-list` is absent | new `StudioDetail.moduleList.svelte.test.ts` |
| T9-WINDOW | With 400 modules only a window of `studio-module-list-row` is mounted, and the reveal of row 350 mounts it (measure stubs as `ModuleSettings.window` does) | R | `origin/main`: no rows | same |
| T9-SEARCH-NAME | `matchingModulePositions([{name: 5}, {name: 'Alpha'}], 'a')` does not throw and returns `[1]`; with `''` it returns `[0, 1]` | R | `origin/main`: `(5).toLowerCase` throws a `TypeError` inside the function under test, so `not.toThrow()` fails | `lib/Setting/Pages/Module/moduleListWindow.test.ts` |
| T9-GLOBAL | The switch adds and removes the id in `enabledModules` (push; splice of the first occurrence), `aria-checked` follows, the owner moves between the two tree groups and the selection is kept; shared-id rows switch together; the integrated note shows for an id **or** a namespace listed in `moduleIntergration` and not otherwise | R | `origin/main`: no switch | `StudioDetail.moduleList` |
| T9-GLOBAL-CLASSIC | Classic page: a module whose **id** (not namespace) is in Module Integration shows the amber state and `moduleOnByIntegration` | R | `origin/main`: classic reads the namespace only (`ModuleSettings.svelte:118-119`), so the amber class and the description are absent | `ModuleSettings.stateColour.svelte.test.ts` |
| T9-CREATE | (OQ-1 B) Prompt answered `'  N  '`: `db.modules` gains exactly `{name: 'N', description: '', id: <uuid>}`; selection is `module:<id>` at `advanced`, `otherModules` and the owner row are expanded, `studio-module-advanced-form` is mounted, no notice. Cancel and blank (`'   '`): no module, selection unchanged, blank says `studioModuleListNameNeeded` | R | `origin/main`: no create button | `StudioDetail.moduleList` |
| T9-DELETE | Confirm text is `removeConfirm + name`; Yes removes exactly the clicked row, also when a row was inserted before it or the list was reordered while the confirm was open; with a second row holding the id, the id stays in `enabledModules`, otherwise it leaves; No changes nothing; a stub row is removed with `acquireModule` never called; the status region says `studioModuleListDeleted(name)` | R | `origin/main`: no delete item | same; plus a `moduleListOps.test.ts` unit form |
| T9-DELETE-CLASSIC | The existing classic delete suite passes unchanged against the helper | C (passes before and after) | none | `ModuleSettings.deleteTarget.svelte.test.ts` (unchanged) |
| T9-REFRESH | Classic page mounted over a bound character whose `modules` lists M. **Prime the memo** with one `getModules()` call that returns M. Delete M through the page; **without unmounting the page**, `getModules()` no longer returns it | R | `origin/main`: the primed memo returns M until `onDestroy` | new `ModuleSettings.refresh.svelte.test.ts` |
| T9-EXPORT | Cancel does nothing; CharX calls `exportModule(acquired)`, Legacy calls `exportModuleLegacy(acquired)`; a stub is acquired once and released once, also when the export throws; an MCP row's item is disabled with `studio-module-list-mcp-note`, and the helper itself refuses MCP (`alertError(mcpModuleConversionUnsupported)`, no export call) for a resident body and for a stub with `mcp: true` | R | `origin/main`: no export item | `StudioDetail.moduleList`; unit form |
| T9-EXPORT-COMPAT | The `.risum` bytes Studio's export produces for the *imported* fixture equal classic's, and `readModule` reads them back to a module equal to the source except `id` and blanked asset keys | C (passes before for classic; Studio reaches the same function) | none | extend the existing `.risum` round-trip suite |
| T9-CONVERT | Pushes exactly `convertModuleToCharacter(module)`'s result (deep-equal, fresh `chaId`), calls `checkCharOrder()` once, says `successfullyConverted`; stub acquired and released; MCP disabled in the menu and refused by the helper with no character pushed. (L3, OQ-4 B) A resident module with `lowLevelAccess: true`, and one with a truthy foreign `1`, asks `studioModuleListConvertLowLevel`; Cancel pushes nothing and releases; Yes pushes a character with the flag on. **Stub case:** the *stub* fixture whose acquired body holds `lowLevelAccess: 1` (the stub itself shows no flag) asks after the acquire. A module with the flag off or absent never asks | R | `origin/main`: no convert item | `StudioDetail.moduleList`; unit form |
| T9-CONVERT-MCP-CLASSIC | Classic convert mode on an MCP row shows `alertError(mcpModuleConversionUnsupported)`, pushes no character, and leaves no unhandled rejection | R | `origin/main`: the throw is not caught; no `alertError`, and the test's unhandled-rejection hook fires | new `ModuleSettings.convert.svelte.test.ts` |
| T9-CONVERT-CLASSIC-ASK | (L3) Classic convert mode on a module with `lowLevelAccess: true` asks `studioModuleListConvertLowLevel`; Cancel pushes no character | R | `origin/main`: classic pushes the character with no ask (`ModuleSettings.svelte:97-111`), so the ask assertion fails | same |
| T9-IMPORT | The two import buttons call `importModule()` and `importMCPModule()` once each, with no argument | R | `origin/main`: no buttons | `StudioDetail.moduleList` |
| T9-MCP-STORE | On the *MCP* fixture the stored module has exactly `name`, `description` (`MCP from <url>`), `mcp: {url}`, `id` and the one `@@mcp` lorebook entry; nothing is enabled | C (passes before and after: pins the stored shape the display relies on) | none | new `process/mcp/tests/mcpImportStore.test.ts` (or extend `mcpImportCancel.test.ts`) |
| T9-NAME-TEXT | A module named `<img src=x onerror=alert(1)>` with a description holding `<b>x</b>` renders as text in the row: no `img` or `b` element inside `studio-module-list`, text content equal to the strings (jsdom) | R | `origin/main`: no row | `StudioDetail.moduleList` (`// @vitest-environment jsdom`) |
| T9-MCP-URL | (L3, OQ-3 B) Through the real `importMCPModule()` with `alertInput` answering each case and the mocks `mcpImportCancel.test.ts` uses (`src/ts/alert`, the database, and `./mcplib` whose `MCPClient` constructor counts calls). `getMCPMeta` itself cannot be mocked: `importMCPModule` calls it through a binding inside `mcp.ts`. **Refused** (`alertError` called with `language.errors.invalidUrl`; the `MCPClient` constructor never called): `http://localhost.invalid/`, `http://127.invalid/`, `http://localhostx.invalid:1/`, the userinfo URLs `http://localhost@evil.invalid/` and `http://127.0.0.1@evil.invalid/`, `stdio:{"url":"http://evil.invalid/"}`, `stdio:{"url":"http://localhost@evil.invalid/"}`, `stdio:{"url":5}`, `http://127.0.0.invalid/` (a domain, not IPv4), `http://xlocalhost/`. **Admitted** (`alertError` never called with `errors.invalidUrl`; `internal:` and `plugin:` never construct `MCPClient`, and the spawn spec then fails outside Tauri with its own message): `http://localhost:8080/mcp`, `http://127.0.0.1:3000/`, `http://127.0.0.2/` (the rest of `127.0.0.0/8`), `http://[::1]:9/`, `https://a.invalid/`, `internal:dice`, `plugin:x`, `stdio:{"url":"http://127.0.0.1:1/"}`, `stdio:{"url":"https://a.invalid/"}`, the spawn spec `stdio:{"command":"node","args":["x.js"]}`. **Unit form:** a direct test of the pure `admitMcpImportUrl` over the same table (refused false, admitted true); it is the fast mutant-kill form, and its labels follow this row's | R for every refused case except `http://xlocalhost/`, and for `http://[::1]:9/`; C for `http://xlocalhost/` (the base refuses it too, as it does not start with `http://localhost`) and for the other admitted cases (they pass before and after) | `origin/main`: every refused R case passes the base prefix check (each starts with `http://localhost`, `http://127` or `stdio:`), so `alertError` never gets `errors.invalidUrl`; `http://[::1]:9/` matches no base prefix, so the base shows `errors.invalidUrl` for it | new `src/ts/process/mcp/tests/mcpImportUrl.test.ts` (mocks `alertInput`, `alertError` and `./mcplib`) |
| T9-GONE-DELETE | S5 form open on M with a namespace draft typed and not committed; an outside removal of M (`undoImport` of an import record holding M) → selection cleared, notice `studioRefusalModuleGone`, no other module changed, no history step | R | `origin/main`: notice is `studioNotFound` | `StudioDetail.moduleAdvanced.svelte.test.ts` |
| T9-GONE-NOTFOUND | A chat or character owner that vanishes still clears with `studioNotFound` | C (passes before and after) | none | `StudioDetail.svelte.test.ts` |
| T9-GONE-REPLACE | S5 form open on M (unique id, published) with a namespace draft and a name composition held; the *replace-imported* fixture (incoming with no `namespace` key) replaces M. **Then the leave step:** `setStudioSelection` to the character owner, which unmounts the form if it is still mounted. Assert: the notice is `studioRefusalModuleGone`; the slot holds the incoming module's fields (no `namespace` key, name from the file); no step recorded for `module:<id>`; `openStudioModuleId()` is null; reselecting M shows the new content and its earlier history steps | R | `origin/main`: the form stays mounted through the replace; the leave step unmounts it and its `commitNamespace` writes the draft onto the new content, so the "no `namespace` key" assertion fails (and the notice is absent) | same |
| T9-WITHDRAW-ORDER | **Seam (option a): a probe in `describeReplace` that only records.** A partial `vi.mock` of `src/ts/process/moduleDuplicates` keeps every real export and wraps `describeReplace`: the wrapper calls the probe, then the real function. `commitModule` calls `describeReplace` synchronously at the end of its replace branch, after the withdraw. The probe **asserts nothing**: it increments `probeRuns`, stores `seenPublished = openStudioModuleId()`, calls `service.editText(moduleOwnerKey(M), 'moduleName', 'x', 'single')` and stores its result as `seenEdit` and the slot's `name` right after it as `seenName`. Reason: `importModuleFile` catches every throw other than `ModuleImportStopped` and turns it into a refused outcome, so a failing `expect` inside the probe would never reach the test. Setup: publish M with `publishOpenModuleId(M)` and a history service over the real setters, then warm the owner with `service.useOwner(moduleOwnerKey(M)); await service.whenReady(moduleOwnerKey(M))` (as `studioHistoryService.svelte.test.ts` does), so that on the base the probe's edit is accepted instead of refused `loading`; `await importModule()` with the *replace-imported* fixture targeting M. **After `importModule()` resolves** the test asserts: `probeRuns === 1` (a missed interception fails instead of passing vacuously); the import replaced M and its end report lists no refusal; `seenPublished` is null; `seenEdit` is refused `not-selected`; `seenName` is the incoming module's name, not `'x'` | R | `origin/main`: there is no withdraw, so the probe records M as published and an accepted edit with `seenName === 'x'`; the post-import assertions on `seenPublished`, `seenEdit` and `seenName` fail | new `src/ts/process/tests/moduleReplaceWithdraw.svelte.test.ts` |
| T9-WITHDRAW-SCOPE | Publish M; replace N (another module) through the same import path → `openStudioModuleId()` is still M, a write to M lands, no notice | C (passes before and after) | none | same |
| T9-STUB-LINK | A stub module's detail shows `studio-module-show-in-list` with `studioShowInModuleList` and no `studio-detail-classic`; activating it selects `list:modules`, `settingsOpen` stays false, and the row is revealed and focused | R | `origin/main`: the link reads `studioOpenModules` and opens Settings | amend `StudioDetail.svelte.test.ts`, `StudioDetail.moduleForm.svelte.test.ts`, `StudioDetail.moduleAdvanced.svelte.test.ts` (their `studioOpenModules` assertions, amended on purpose) |
| T9-CLASSIC-KEEP | A loaded module still shows `studio-detail-classic` with `studioOpenClassic` (interim for #708) | C (passes before and after) | none | same |
| T9-SHOW-IN-LIST | A loaded module's detail shows `studio-module-show-in-list`; with description text held in its long-text field, activating it writes the text (one step) before the selection becomes `list:modules` | R | `origin/main`: no button | `StudioDetail.moduleAdvanced` |
| T9-FLUSH-EXPORT | Type into the module's description (held), Show in list, Export Legacy: the exported snapshot's description is the typed text | R | `origin/main`: no route | `StudioDetail.moduleList` |
| T9-LIST-HISTORY | With `list:modules` selected, `selectedHistoryOwner()` is null and the History panel lists no owner | C (the rule "unknown key → null" passes before and after) | none | `studioScreen.svelte.test.ts` |
| T9-DELETE-LOADING | Delete a stub while its Studio load is pending; the load settles without reinstalling a row and without a notice beyond the delete's | D (documents inherited loader behaviour; a failure is a follow-up, not a #709 blocker) | none | `StudioDetail.moduleList` |
| T9-PARTS | `areaParts.test.ts` passes with the new literal parts and no change to the file | C | none | existing |
| T9-LOC | `localeParity` passes with the new keys in all 8 files and `studioOpenModules` gone from all 8 | C | none | existing |

**Mutants that must be killed.** Each breaks one new rule; the named tests must fail.

| Mutant | Must fail |
|---|---|
| `removeModuleRow` finds the row by id (`findIndex(m => m.id === row.id)`) | T9-DELETE (shared-id and reorder cases), `deleteTarget` suite |
| `removeModuleRow` removes the id from `enabledModules` whether or not another row holds it | T9-DELETE |
| `removeModuleRow` skips `refreshModules()` | T9-REFRESH |
| `removeModuleRow` calls `useModuleRow` first | T9-DELETE (stub case: `acquireModule` called) |
| `exportModuleRow` releases outside `finally` | T9-EXPORT (throw case) |
| `exportModuleRow` drops its own MCP refusal (menu-only guard) | T9-EXPORT (helper case) |
| `convertModuleRow` drops its `try` (classic's behaviour) | T9-CONVERT-MCP-CLASSIC |
| `convertModuleRow` skips the low-level ask, or asks only on `lowLevelAccess === true` | T9-CONVERT (low-level and foreign `1` cases), T9-CONVERT-CLASSIC-ASK |
| `convertModuleRow` asks on the clicked row before acquiring | T9-CONVERT (stub case: the stub shows no flag, so no ask) |
| The ask lives in Studio's page instead of the helper | T9-CONVERT-CLASSIC-ASK |
| `matchingModulePositions` drops the string guard (classic's code) | T9-SEARCH-NAME |
| `moduleIntegrationState` reads the namespace only (classic's rule) | T9-GLOBAL, T9-GLOBAL-CLASSIC |
| Create pushes before the prompt answer (classic's order) | T9-CREATE (Cancel and blank cases) |
| Create stores the untrimmed answer | T9-CREATE (`'  N  '` stored as `'N'`) |
| Create selects without expanding the group, or before the push (with a model read before the push) | T9-CREATE (group expanded; no `studioNotFound`) |
| The not-found effect does not skip `list:modules` | T9-LIST-ROWS |
| The not-found notice stays `studioNotFound` for modules | T9-GONE-DELETE |
| The not-found notice uses `studioRefusalModuleGone` for every owner type | T9-GONE-NOTFOUND |
| `commitModule` does not call `withdrawOpenModuleId` | T9-GONE-REPLACE, T9-WITHDRAW-ORDER |
| `withdrawOpenModuleId` clears whatever is published | T9-WITHDRAW-SCOPE |
| The withdraw runs in a microtask (after the commit returns) | T9-WITHDRAW-ORDER (the probe records M still published and an accepted edit) |
| The withdraw is placed after `describeReplace` | T9-WITHDRAW-ORDER (the probe runs before it and records M published) |
| The stub link still calls `openInClassicEditor` | T9-STUB-LINK |
| `openStudioModuleList` writes `studioScreen` directly instead of `setStudioSelection` (no flush) | T9-SHOW-IN-LIST, T9-FLUSH-EXPORT |
| The row renders the name with `{@html}` | T9-NAME-TEXT |
| Row keys by index instead of `moduleRowKeys` | T9-LIST-ROWS (node kept across a search) |
| The search uses Studio's item search (skips stubs) | T9-LIST-ROWS (stub match) |
| (L3) The admission keeps `startsWith('http://localhost')` | T9-MCP-URL (`localhost.invalid`, `127.invalid`, `localhostx.invalid` cases) |
| (L3) The host is taken by text prefix or by splitting the string, not from the parsed URL | T9-MCP-URL (userinfo cases) |
| (L3) The admission ignores the `stdio-url` inner URL (any `stdio:` passes) | T9-MCP-URL (`stdio:{"url":"http://evil.invalid/"}` and `stdio:{"url":5}` cases) |
| (L3) The `stdio-url` inner URL is checked by the old text prefix (`http://localhost`, `http://127`, `https:`), not by the same URL parse as a top-level URL | T9-MCP-URL (`stdio:{"url":"http://localhost@evil.invalid/"}` case) |
| (L3) The admission refuses a port, `[::1]`, or a loopback `stdio-url` | T9-MCP-URL (admitted cases) |
| (L3) The admission accepts only `127.0.0.1` of `127.0.0.0/8` | T9-MCP-URL (`http://127.0.0.2/` case) |
| (L3) The admission takes `hostname.endsWith('localhost')` | T9-MCP-URL (`http://xlocalhost/` case) |
| (L3) The 127 check counts four labels whose first is `127` without requiring an IPv4 address | T9-MCP-URL (`http://127.0.0.invalid/` case) |
| (L3) The admission refuses a spawn spec | T9-MCP-URL (spawn case) |

**Gate 2:** one combined opus-reviewer for contracts 1 to 4. The failure scenarios to name: F1-F5, F7, F11, F12 and F14 of section 6; the accepted limitation in section 4 (the reviewer checks that the spec's and the PR's wording keep it a prompt-only check); and "a Studio list operation writes a module or character field that classic's same operation does not write". `pnpm check` and the targeted suites above. No APK for the review.

**Device rows (Note 9, synthetic data; the build session's call under the approval matrix):** create and open a module; import a `.risum` through the Android picker; export CharX (save dialog and task card over Studio); import `internal:dice` as an MCP module; delete it; one replace-import while a module form is open.

## 9. Engine and code changes, sizes, stages

| # | Change | Files | Size (ESTIMATE) |
|---|---|---|---|
| L-H | Shared helpers | new `src/ts/process/moduleListOps.ts` | S (~150) |
| L-C | Classic page calls the helpers (delete, toggle, export, convert, integration state); its convert gains the catch and its delete the immediate refresh | `src/lib/Setting/Pages/Module/ModuleSettings.svelte` | S (-60, +25) |
| L-N | String guard in the shared search | `src/lib/Setting/Pages/Module/moduleListWindow.ts` | XS (~2) |
| L-W | `withdrawOpenModuleId` and the `withdrawn` state (no token change), reset by a publish of another id and by `resetOpenModuleIdForTests` | `src/ts/studio/assets/openModuleForm.svelte.ts` | XS (~25) |
| L-I | Replace branch calls the withdraw, right after `applyModulePlacement` and before `describeReplace` | `src/ts/process/modules.ts` (`commitModule`) | XS (~3) |
| L-D | Not-found effect: skip the list key, module notice `studioRefusalModuleGone`, react to `withdrawn`; mount the list page; `studio-module-show-in-list`; remove the stub classic branch | `src/lib/Studio/StudioDetail.svelte` | S (~45) |
| L-S | `MODULE_LIST_KEY`, `openStudioModuleList`, `openStudioModuleOwner(model, row, kind)` (finds the owner in the given model and expands its group path); `revealListRow` comment widened | `src/ts/studio/studioScreen.svelte.ts` | S (~45) |
| L-T | Tree entry row | `src/lib/Studio/StudioTree.svelte` | XS (~15) |
| L-P | The page: toolbar, search, windowed rows, switch, menu, status, reveal | new `src/lib/Studio/StudioModuleList.svelte` | M (350-450) |
| L-M | `admitMcpImportUrl` in place of the prefix check, with one `admitHttpUrl` (URL parse) for the top-level and the `stdio-url` inner URL | `src/ts/process/mcp/mcp.ts` | S (~45) |
| L-V | The low-level ask inside `convertModuleRow`, on the acquired body; classic asks through the same helper | `moduleListOps.ts` | XS (~20) |
| L-K | Keys | `src/lang/*.ts` (8 files) | S |

**Totals (ESTIMATE):** 10-11 application files changed or added plus 8 locale files; about 7 new and 9 extended or amended test files; about 2,000-2,600 lines including tests.

**Stages.** One build PR, one coder per stage (serial, one worktree), one combined Gate 2.

| Stage | Contents | Tests | Recommended coder | Why |
|---|---|---|---|---|
| **L1 (contracts)** | L-H (without L-V), L-C, L-N, L-W, L-I, the not-found and `withdrawn` parts of L-D | T9-DELETE (unit and classic), T9-DELETE-CLASSIC, T9-REFRESH, T9-SEARCH-NAME, T9-GLOBAL-CLASSIC, T9-CONVERT-MCP-CLASSIC, T9-EXPORT (unit), T9-MCP-STORE, T9-GONE-DELETE, T9-GONE-NOTFOUND, T9-GONE-REPLACE, T9-WITHDRAW-ORDER, T9-WITHDRAW-SCOPE. Demonstrate T9-REFRESH, T9-SEARCH-NAME, T9-GLOBAL-CLASSIC, T9-CONVERT-MCP-CLASSIC, T9-GONE-DELETE, T9-GONE-REPLACE and T9-WITHDRAW-ORDER failing on `origin/main` | **Opus** | Changed critical contracts 1 and 2: a wrong-row removal, a stale memo or held text landing on replaced content is silent data loss |
| **L2 (page)** | L-P, L-S, L-T, the mount and link parts of L-D, L-K (English) | T9-TREE, T9-LIST-ROWS, T9-WINDOW, T9-GLOBAL, T9-CREATE, T9-DELETE (page), T9-EXPORT (page), T9-CONVERT (without the low-level and stub-ask cases), T9-IMPORT, T9-NAME-TEXT, T9-STUB-LINK, T9-CLASSIC-KEEP, T9-SHOW-IN-LIST, T9-FLUSH-EXPORT, T9-LIST-HISTORY, T9-DELETE-LOADING, T9-PARTS | **Sonnet** | UI over L1's helpers; no contract of its own beyond calling them; jsdom tests |
| **L3 (security)** | L-M and L-V with the conversion key | T9-MCP-URL, T9-CONVERT (low-level and stub-ask cases), T9-CONVERT-CLASSIC-ASK. Demonstrate the refused T9-MCP-URL cases, its `http://[::1]:9/` case and T9-CONVERT-CLASSIC-ASK failing on `origin/main`. The translator's 7 locale files land at the end of L3; `localeParity` then (T9-LOC) | **Opus** | Changed critical contracts 3 and 4: the prompt's network admission and a security confirm (gates.md Gate sequence item 4) |

L3 is built: OQ-3 and OQ-4 were both answered B. Tier: **2** (security path, persisted module list writes). The plan is not expensive to reverse (no stored format change), so senior-advisor challenge is not required by the gates. **Grilling (MC-778):** gates.md requires a grilling step for Tier 2 before Gate 1. The four product questions were asked and answered (MC-4120), and the F2 residual was answered on 2026-11-24; whether that counts as the grilling step or a separate grilling pass is the orchestrator's call (section 12).

**Coordination.**
- #683 S5 (5c, forms) and #709 L2 both edit `StudioDetail.svelte` deriveds: a mechanical conflict. L1's withdraw relies on S5's published-id check, which is on `main`.
- #708 keeps `studioOpenClassic` on loaded modules; this spec does not touch `classicLinks.svelte.ts`.
- #710 (preset list) may reuse the page pattern (fixed tree entry, list key, reveal); it has its own spec.

## 10. Decided product questions (record)

The maintainer answered all four on 2026-11-24 (MC-4120, `Agents/mc/709.md`). Each took the recommended option. The build follows these.

- **OQ-1 Create: B.** Ask for a name first. Cancel or a blank name creates nothing. Then create the module and open its 고급 form with that name.
- **OQ-2 Delete: A.** A confirm naming the module, no Undo. Nothing new is stored or restored.
- **OQ-3 MCP URL: B.** Parse the URL. Plain `http://` only for the hosts `localhost`, `127.0.0.0/8` and `[::1]`, any port. Everything else as today. The function is shared, so classic changes too. Stage L3 (L-M) is built; option C's confirm is not. Revision 1 makes the rule read a `stdio:` value's inner URL through `parseMcpUrl` and read the host only from a URL parse (Gate 1 r1 F1); this implements B and does not reopen it.
- **OQ-3 residual, accepted known limitation (maintainer, 2026-11-24, part of MC-4120; Gate 1 r1 F2).** The host rule gates only the explicit Import MCP prompt, in classic and in Studio. MCP modules that arrive through a module file, a plugin write or a restore keep today's run-time rule, under which the client admits any `http://` URL. Run-time enforcement is not part of #709.
- **OQ-4 Convert with Low Level Access on: B.** Ask first, naming the module and what the flag allows. Cancel makes no character. Stage L3 (L-V) is built. The ask reads the acquired module and applies to classic too, through the shared helper.

## 10b. Gate 1 r1 dispositions

Verdict [REJECT] (opus-reviewer, 2026-11-24, `gate1-r1.md`): F1-F3 SUBSTANTIVE, F4-F11 EDITORIAL. The reviewer's "Simpler path" section found none.

| Finding | Disposition | Where |
|---|---|---|
| F1 OQ-3 B admission misses the `stdio:` URL form; userinfo URLs | **ADDRESSED.** Source checked: `stdioSpec.ts:21-60` (`stdio-url` when a truthy `url` key exists), `mcp.ts:172-177, 276-281`. `admitMcpImportUrl` reads `stdio:` through `parseMcpUrl` and applies the host rule to a `stdio-url` inner URL; the host comes only from `new URL`. New R cases (two userinfo URLs, `stdio:{"url":"http://evil.invalid/"}`, `stdio:{"url":5}`), new C cases (loopback and https `stdio-url`, a spawn spec), and the two named mutants plus a spawn mutant. | §4, §6 F11, §8, §9 L-M, §10 |
| F2 Contract 3 and F11 overstate the boundary | **ADDRESSED** by the maintainer's decision (2026-11-24, recorded with MC-4120): an accepted known limitation. Contract 3 is renamed a prompt-only check; files, plugins and restores keep the run-time rule. | §1.1, §3.5 item 3, §4 "Inherited limits", §6 F11, §8 Gate 2, §10 |
| F3 T9-WITHDRAW-ORDER cannot observe "synchronously after it returns" | **ADDRESSED** with option (a): a partial mock of `moduleDuplicates` whose `describeReplace` runs the probe inside the commit's synchronous block. Source checked: `modules.ts:673-686` calls `describeReplace` last in the replace branch. The withdraw is pinned right after `applyModulePlacement` and before `refreshModules()`. Mutants: microtask, and placed after `describeReplace`. The test moves to `src/ts/process/tests/`. | §3.4, §8, §9 L-I |
| F4 The ask should read the acquired body; no stub case | **ADDRESSED.** Resolved the reviewer's UNCERTAIN item: the store2 index entry keeps `lowLevelAccess` only when it is a boolean (`codec/modules.ts:53-55`), so a stub of a module holding `1` shows no flag. The ask runs after `useModuleRow` on the acquired module; T9-CONVERT gains the stub case; mutant "asks on the clicked row before acquiring". | §0, §3.1, §8 |
| F5 "The only replace write" incomplete | **ADDRESSED.** Section 0 row reworded to "the only import replace write" with the other id-keeping writes named; a plugin full-list write is a named limitation in §3.4 "Not covered". Source checked: `plugins.svelte.ts:640-641`. | §0, §3.4 |
| F6 Classic gains the ask through the helper, unstated | **ADDRESSED.** Named in §3.2 "Classic page consequences" and §12; new T9-CONVERT-CLASSIC-ASK (R) and mutant "the ask lives in Studio's page". | §3.1, §3.2, §8, §12 |
| F7 Test-setup precision (T9-REFRESH, T9-GONE-REPLACE, T9-TREE) | **ADDRESSED.** T9-REFRESH primes the memo; T9-GONE-REPLACE names the leave step (`setStudioSelection` to the character owner) and the "no `namespace` key" assertion; T9-TREE finds `data-row-id="l:modules"`. | §8 |
| F8 Key and inventory corrections | **ADDRESSED.** Reuse `studioSearchNoResults` (new part `studio-module-list-no-match`) and `studioBadgeAllChats`; `errors.invalidUrl` added to the reused list; MCP tests under `src/ts/process/mcp/tests/`. The open item about the no-results key is closed. | §2.2, §2.5, §7, §8, §12 |
| F9 Search throws on a non-string name | **ADDRESSED** with a guard, not a limitation: `matchingModulePositions` reads a name only when it is a string (L-N, shared, so classic is fixed too); T9-SEARCH-NAME (R) and its mutant; F14. | §0, §2.4, §3.2, §6, §8, §9 |
| F10 Build-detail gaps | **ADDRESSED.** `openStudioModuleOwner(model, row, kind)` takes the model, read after the push; Create stores the trimmed name (test and mutant); the `id#n` wording edge is accepted in §3.4. | §3.2, §3.4, §8, §9 L-S |
| F11 Records wording; grilling | **ADDRESSED.** The decisions line now says MC-4120 is in `Agents/mc/709.md` (MC-3044) and the rest are folded; MC-912 added. Grilling noted in §9 and §12 as an orchestrator item. | header, §9, §12 |

## 10c. Gate 1 r2 dispositions

Verdict [REJECT] (opus-reviewer, 2026-11-24, `gate1-r2.md`): R2-1 and R2-2 SUBSTANTIVE, R2-3 to R2-5 EDITORIAL. Round 1: F2 and F4-F11 fixed; F1 and F3 fixed in the design and completed here. "Simpler path": none; its optional single `admitHttpUrl` is adopted. No mechanism changes.

| Finding | Disposition | Where |
|---|---|---|
| R2-1 An inner URL checked by the old prefix survives T9-MCP-URL | **ADDRESSED.** Source checked: `stdioSpec.ts:35-36` (a truthy `url` key gives `stdio-url` with that value), `mcp.ts:557-564` (the base admits any `stdio:`). New refused R case `stdio:{"url":"http://localhost@evil.invalid/"}` and the mutant row "the `stdio-url` inner URL is checked by the old text prefix", killed by it. Section 4 rule 3 sends both URL paths through one `admitHttpUrl`. | §4, §8 T9-MCP-URL and mutants, §9 L-M |
| R2-2 Assertions inside the T9-WITHDRAW-ORDER probe are swallowed | **ADDRESSED.** Source checked: `modules.ts:742-795` (the `try` around every route; its `catch` returns `outcomeOfError` for every throw other than `ModuleImportStopped`), `modules.ts:673-686`. The probe only records (`probeRuns`, `seenPublished`, `seenEdit`, `seenName`); the test asserts after `importModule()` resolves, asserts `probeRuns === 1`, and asserts the replace landed with no refusal. | §8 T9-WITHDRAW-ORDER and its mutant rows |
| R2-3 `getMCPMeta` cannot be mocked from outside `mcp.ts` | **ADDRESSED.** Source checked: `mcp.ts:576` (the call uses the binding inside the module), `mcpImportCancel.test.ts:19-36` (the suite mocks `./mcplib` and counts `MCPClient` constructions). Refused cases assert `alertError(errors.invalidUrl)` and no `MCPClient` construction; admitted cases assert no `errors.invalidUrl`; a direct unit test of `admitMcpImportUrl` over the same table kills the mutants, the spawn one included. | §8 T9-MCP-URL |
| R2-4 `http://[::1]:9/` is labelled C but fails on the base | **ADDRESSED.** Relabelled R (no base prefix matches `http://[`, `mcp.ts:557-564`); L3 demonstrates its base failure. | §8 T9-MCP-URL, §9 L3 |
| R2-5 The "does not advance the token" mutant is equivalent | **ADDRESSED** by dropping the token advance from `withdrawOpenModuleId` and the mutant row. Source checked: `openModuleForm.svelte.ts:21-32` (a teardown clears by its own token and only sets the id to null). The withdraw's place relative to the synchronous `refreshModules()` is no longer stated as pinned. | §3.4, §8 mutants, §9 L-W and L-I |

## 10d. Gate 1 r3 dispositions

Verdict [EDITORIAL] (opus-reviewer, 2026-11-24, `gate1-r3.md`): R2-1 to R2-5 fixed, no SUBSTANTIVE finding, no re-review. Revision 3 applies E1-E4 and nothing else.

| Finding | Disposition | Where |
|---|---|---|
| E1 `127.0.0.0/8` tested only at `127.0.0.1` | **ADDRESSED.** Admitted C case `http://127.0.0.2/` and mutant "accepts only `127.0.0.1`". | §8 T9-MCP-URL and mutants |
| E2 Two host-check mutants survive (optional) | **ADDRESSED.** Refused cases `http://xlocalhost/` (C: the base refuses it too) and `http://127.0.0.invalid/` (R), with their mutant rows. | §8 T9-MCP-URL and mutants |
| E3 T9-WITHDRAW-ORDER base text assumes a warmed owner | **ADDRESSED.** The setup warms the owner (`useOwner` then `whenReady`) before the import. | §8 T9-WITHDRAW-ORDER |
| E4 `withdrawn` has no reset outside the detail | **ADDRESSED.** The detail's clear, a publish of another id and `resetOpenModuleIdForTests` reset it. | §3.4, §9 L-W |

## 11. Premises

| Premise | Status |
|---|---|
| Classic list, search, windowing, row actions, MCP disabling, delete rule, create shape and convert flow | REOPENED (`ModuleSettings.svelte:1-288`, read whole) |
| `moduleRowKeys` and `matchingModulePositions` behaviour, including the throw on a non-string name | REOPENED (`moduleListWindow.ts:9-31`) |
| `importMCPModule` steps, checks, outcomes and stored shape | REOPENED (`mcp.ts:538-613`) |
| `importMCPModule` calls `getMCPMeta` through a binding inside `mcp.ts`; the existing import suite mocks `./mcplib` and counts `MCPClient` constructions | REOPENED in revision 2 (`mcp.ts:576`; `mcpImportCancel.test.ts:19-36`) |
| `importModuleFile` turns every throw other than `ModuleImportStopped` into an outcome, so a throw inside `describeReplace` never reaches the caller of `importModule()` | REOPENED in revision 2 (`modules.ts:742-795`) |
| A detail teardown clears the published id only with its own, still current token | REOPENED in revision 2 (`openModuleForm.svelte.ts:21-32`) |
| `parseMcpUrl` returns `stdio-url` for a truthy `url` key, and `createMCPClient` uses the inner URL | REOPENED in revision 1 (`stdioSpec.ts:21-60`; `mcp.ts:172-177, 276-281`) |
| MCP client creation, stdio refusal outside desktop, http(s) check | REOPENED (`mcp.ts:105-325`) |
| stdio consent and where approvals live | REOPENED (`stdioApproval.ts:1-167`) |
| OAuth consent before helper contact; refresh tokens in `db.authRefreshes` | REOPENED (`mcplib.ts:680-717`; `mcp.ts:263-272`) |
| Modules from files keep `mcp`; run-time MCP entries come from every referenced module | INHERITED from Gate 1 r1 (`modules.ts:485-508, 811-831, 1038-1049`); the plugin write REOPENED (`plugins.svelte.ts:640-641`) |
| Export functions, MCP refusal, retained-path drop, `.risum` snapshot | REOPENED (`modules.ts:70-195`) |
| Import routes, fresh id, low-level asks, stub-key refusal, duplicates | REOPENED (`modules.ts:649-914`; `moduleDuplicates.ts:1-71`) |
| `applyModulePlacement` has one production caller; `commitModule`'s replace branch order with no await | REOPENED (Grep `applyModulePlacement\(` over `src`, tests excluded: 2 hits, the definition and `modules.ts:675`; `modules.ts:673-686`) |
| `getModules` memo and `refreshModules` | REOPENED (`modules.ts:933-952, 1164-1168`) |
| `convertModuleToCharacter` throws for MCP and copies `lowLevelAccess` | REOPENED (`interchangeability.ts:8-60`) |
| The store2 module index entry keeps `lowLevelAccess` only as a boolean | REOPENED in revision 1 (`codec/modules.ts:53-55`) |
| `useModuleRow` acquire and failure message | REOPENED (`moduleUse.ts:1-85`) |
| `undoImport` removal and refresh | REOPENED (`importUndo.ts:58-108`) |
| Stubs carry entry fields; loader never reinstalls a deleted stub | REOPENED (`moduleStubMatch.ts:12-26`; `moduleLoader.ts:140-193`) |
| Studio tree groups, paging, row menu | REOPENED (`StudioTree.svelte:1-372`) |
| `StudioDetail` not-found effect, publish effect, stub link | REOPENED (`StudioDetail.svelte:1-321`) |
| Owner ids of shared-id rows; `moduleRowOf` | REOPENED (`ownerModel.ts:410-434`; `openModuleForm.svelte.ts:50-59`) |
| A module write is refused `not-selected` unless its id is published | REOPENED (`studioSetters.ts:78-94`); the service passes the getter (`studioHistoryService.svelte.ts:133`); Gate 1 r1 confirmed `view().editable` does not read the published id, so a flush after the withdraw reaches the service and is refused |
| `setStudioSelection` flushes, `clearStudioSelection` does not; `groupPathOf` needs `active` | REOPENED (`studioScreen.svelte.ts:375-421, 449-481`; `fieldFlush.ts:1-65`) |
| The S5 form's unmount flush writes nothing once its module is gone; held long text is dropped on unmount | REOPENED (`StudioModuleAdvancedForm.svelte:61-68, 93-126, 185-194`); the long-text dispose INHERITED from Gate 1 r1 (`LongTextField.svelte:589-593`; `longText/fieldWrite.ts:123-126`); the toggle builder's and the module asset form's unmount behaviour INHERITED (they write through the same service, so the published-id check applies; not re-read) |
| Owner model re-derives synchronously on a `db.modules` push | REOPENED (`ownerSource.svelte.ts:66-82`); Svelte's derived read-after-write INHERITED (not re-checked in resolved source; T9-CREATE observes it) |
| `enabledModules` and the module list are save-tracked | REOPENED (`dbChangeEffects.svelte.ts:195-262`) |
| No owner-deletion path in the history store | REOPENED (Grep, 0 files) |
| `studioSearchNoResults` and `studioBadgeAllChats` exist | REOPENED (`en.ts:2492, 2734`) |
| Alerts and task cards show over Studio on Android, and Back closes them | INHERITED (Studio already raises `alertError` and downloads; App mounts Studio in the main area as Settings; the device rows check the picker, the save dialog and the card) |
| Store2 drops a removed module's unit correctly | INHERITED from classic delete (not re-read; unchanged mutation) |
| `areaParts.test.ts` accepts literal `studio-*` parts under `src/lib/Studio` with no edit | REOPENED (`themePack/areaParts.test.ts:9-82`); Gate 1 r1 confirmed |
| #709 body and the MCP comment | REOPENED (`gh issue view 709 --repo yor42/RisuTanium`, 2026-11-24) |
| No sizing packet was supplied; the premises above were reopened by this designer | — |

## 12. Open items for the Orchestrator and lane A

- **Answers recorded during the build (2026-11-24).** MC-3896 applied to modules: confirmed by the maintainer (MC-4122). Grilling (MC-778): the four product questions and the F2 residual were asked and answered (MC-4120); no separate grilling pass was run, and lane A accepted that on 2026-11-24. The shared-id fixture: no producer exists, the tests use hand-built pairs and the MCP fixture is hand-built too (T9-MCP-STORE pins the real stored shape). The build-session placement and the `ModuleChatMenu` counterpart (#753) are settled; the rest of this section stays as written.
- **MC-3896 extended to modules (section 3.4).** The brief required it; it changes today's behaviour on a replace (the form now stays on the new content). Please confirm it is covered by MC-3896's intent, or ask the maintainer (A: keep the form on the replaced content; B: section 3.4).
- **MC-4120 record.** Section 10 records the F2 residual as part of MC-4120 on the orchestrator's word (maintainer, 2026-11-24). `Agents/mc/709.md` needs the matching line if it does not have it yet.
- **Grilling (MC-778, Tier 2).** Please record whether the product questions answered under MC-4120 count as the grilling step, or run a separate grilling pass before the next Gate 1 round.
- **Per-chat and per-character module choice** (`ModuleChatMenu.svelte`) has no Studio counterpart and #709 does not name it. Under MC-4030 lane A may want a ticket for it.
- **Shared-id fixture producer (MC-329).** The build names the producer of two rows sharing an id, or records that none exists and uses a hand-built pair.
- **Classic page changes.** L1 and L3 change classic's convert (catch; the low-level ask through the shared helper), delete (immediate refresh), integration display (id or namespace) and search (string guard). They follow from sharing the helpers and are named here so Gate 1 can object.
- **Removing `studioOpenModules`** touches all 8 locale files in the translator's batch.
