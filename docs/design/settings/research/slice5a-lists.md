# Slice 5a source read: Hotkeys, Personas, Plugins, Modules

Static source read, 2026-10-28 (no build, no run). Paths relative to `src/`. OBSERVED = read in cited source; INFERRED = my reading of runtime behaviour. Section 7 is the only place with proposals-as-questions. Builds on `research/today-settings.md` (§2 page table, §6 hotkeys) and does not repeat its menu/shell findings. Maintainer scope note applied: in 확장 a module gets an info page plus "Open in Studio"; contents tabs are only mapped, not detailed.

## 1. Hotkeys (`lib/Setting/Pages/HotkeySettings.svelte` 72 lines, `ts/defaulthotkeys.ts` 145, `ts/hotkey.ts` 569)

**Action list (25 defaults, not 26 as today-settings.md §6 says; recount of `defaulthotkeys.ts`).** Label text `language.hotkeyDesc[action]` (`lang/en.ts:1893-1919`); en also carries unused `import`/`export` labels.

| Group | Action (default) | Handler |
|---|---|---|
| Message ops, Ctrl+Alt | reroll R, unreroll F, translate T, remove D, edit E, copy C, send Enter | yes, but by `document.querySelector('.button-icon-*')` then `.click()` (`hotkey.ts:143-180`). Fails silently if that button is not on screen. |
| Navigation, Ctrl | settings S, home H, presets P, persona E, prevChar `[`, nextChar `]`, quickMenu `` ` ``, quickSettings Q, loadout O | yes (`hotkey.ts:180-300`) |
| Tools, Ctrl | toggleCSS `.` (safe mode), toggleLog L, previewRequest U (also swallows browser view-source) | yes |
| Other | focusInput Space (no modifier), scrollToActiveChar G (hidden when `enableScrollToActiveChar` is false, `database.svelte.ts:658-661`), popupEditor X | focusInput and scrollToActive yes; popupEditor is read in `lib/UI/GUI/TextAreaInput.svelte:73`, not in `hotkey.ts` |
| **No handler found** | modelSelect Ctrl+M, toggleVoice Ctrl+V, webcam Ctrl+W | grep: only default + label. INFERRED dead rows still shown in the table. Ctrl+V and Ctrl+W also collide with paste and browser close-tab. |

Modifier detail is OBSERVED from the defaults file; the 7 message ops are Ctrl+Alt, the rest Ctrl, focusInput none.

**Capture.** OBSERVED (`HotkeySettings.svelte:60-67`): a readonly-looking text input; `onkeydown` does `preventDefault()` and stores `e.key` raw. Modifiers are NOT read from the keypress; Ctrl/Shift/Alt are three separate toggle buttons that are only text-colour changed (`:27-58`, no pressed state, no aria). Consequences (OBSERVED/INFERRED): pressing Shift+A stores "A" while Shift toggle stays as set; pressing a modifier key alone stores "Control"/"Shift"; Tab is swallowed so the keyboard user is trapped in the field (INFERRED, `preventDefault` on every key); no IME handling in capture (matcher side has `isComposing` only for Enter-answer, `hotkey.ts:73-79`); no Escape-to-cancel. Display: key upper-cased, space shown "SPACE".

**Mac.** No Cmd handling: `hotkeyMatches` (`hotkey.ts:457-472`) compares only `ctrlKey/altKey/shiftKey` and lowercased `key`. `metaKey` is never matched, so on Mac "Ctrl" means the physical Control key. INFERRED: Alt+letter produces a different `key` on Mac (option characters), so Ctrl+Alt rows probably do not match there.

**Matching rules.** Exact modifier equality; key compared case-insensitively. Hotkeys without any modifier are ignored while an INPUT/TEXTAREA is focused (`:468-470`, and the early return at `hotkey.ts:94-103`). A focused button/select that natively takes the key wins (`hotkeyYield.ts`, `shouldYieldToFocusedControl`). While an alert/prompt covers the page, shortcuts are consumed but do nothing (`keysBlocked`, `act()`). First matching row in array order wins (`hotkey.ts:121-139`).

**Conflict/duplicate check.** None (OBSERVED by absence in the page and in the handler). Two rows with the same combo are possible; only the earlier fires. Defaults already clash in label only: persona Ctrl+E vs edit Ctrl+Alt+E are distinct combos. No warning for browser-reserved combos.

**Hard-coded keys outside the table** (not rebindable, not listed):
- Ctrl+1..9 -> `changeToPreset(0..8)` (`hotkey.ts:309-366`, helper `:560-569`); runs only if no table row matched. There is no Ctrl+0.
- Escape closes alerts and Settings (`hotkey.ts:379-395`); Enter answers confirm/notice (`:396-406`, with a short guard so a fresh alert cannot be dismissed instantly).
- Triple-touch -> quickMenu (`hotkey.ts:410-440`).
- Ctrl+S toggles Settings is a table row; Escape closing it is not.

**Reset.** None (no button; no per-row reset). Only partial self-heal: on load, missing default *actions* are appended (`database.svelte.ts:647-657`), so a user's edited rows are never restored. Deleting a row is impossible in the UI, so reset has no equivalent.

**Storage.** `db.hotkeys: Hotkey[]` with `{key, ctrl?, shift?, alt?, action}` (`database.svelte.ts:1226`, `defaulthotkeys.ts:2-8`): in the main database (so it syncs/backs up with it), not per device. `hotkeyMatches` mutates missing flags to false on the stored object (`hotkey.ts:462-464`).

**Layout.** Page renders only "Screen is too small" under 768 px (`:8-11`, read once at mount, not reactive). Plain `<table>`, one heading cell (`<th>` for the whole table), rows have no labels for the key input.

## 2. Personas (`lib/Setting/Pages/PersonaSettings.svelte` 178, `lib/Setting/listedPersona.svelte` 47, `ts/persona.ts` 151)

**Data** `RisuPersona` (`database.svelte.ts:838-846`): `name, icon, personaPrompt (the "description"), note?, largePortrait?, id?, embeddedModule?: RisuModule`. Plus globals `db.personas[]`, `db.selectedPersona` (index), and *live mirror fields* `db.username, db.userIcon, db.personaPrompt, db.userNote` that the editor and the prompt builder read. `db.personaNote` (Advanced, experimental-only `advancedSettingsData.ts:208`) gates whether the Note field renders (`PersonaSettings.svelte:141-143`) but the "Note" label is shown regardless (`:140`).

**Working-copy model (same pattern as presets).** The editor binds the live fields; they are copied back into `personas[i]` by `saveUserPersona()` on switch, drag start (`PersonaSettings.svelte:24-27`) and image pick (`persona.ts:35-52`). Edits are not persisted into the list entry until one of those. INFERRED: the picker (`listedPersona`) shows the stored name, so renaming the active persona is not reflected there until a switch/save. `largePortrait` is bound directly to the list entry (`:176`), not mirrored.

**UI** (OBSERVED): title; a drag-sortable (SortableJS) grid of 80 px (h-20 w-20) icon squares, active one ringed, no names, no tooltip, no alt text, buttons contain only a div (`:72-89`); a "+" button -> `alertSelect(["Create from scratch","Import"])` (`:92-104`). Below, one editor card: 112 px portrait button (click = pick a PNG), Name, Note (conditional), Description textarea, then Export, Import, Remove (danger), and a "Portrait" checkbox (`largePortrait`, controls `lgcss` vs `css` render of the image in the editor and chat).
- Create: pushes `{name:'New Persona', icon:'', personaPrompt:'', note:''}` and selects it. English literal name; no `id` until a sort or image pick (id assigned lazily, `:25`, `persona.ts:28`).
- Image: PNG only (`selectUserImg`, `persona.ts:13`); stored through `saveImage`; no crop, no size cap in this code. Note: picking an image also assigns a new `id` (`persona.ts:28`), which would break any chat bound to the old id (INFERRED consequence; binding stores the id).
- Export: one persona -> PNG with the persona JSON in a `persona` chunk (`name, personaPrompt, note` only; icon is the image itself; `largePortrait`, `embeddedModule`, `id` are not exported). Refuses with "username or persona prompt is empty" if either is blank (`persona.ts:62-65`). Filename strips `<>:"/\|?*.,`. Blank icon -> 256x256 grey canvas.
- Import: PNG with a `persona` chunk; pushes a new persona with a fresh `id`, icon = the PNG re-encoded. Requires `name` and `personaPrompt`. Alerts success/`noData`. No preview, no duplicate-name check, does not select it. Only one file at a time. (Module-style import of other card types lives elsewhere: `interchangeability.ts` converts persona<->character card.)
- Remove: hidden no-op when only one persona remains (`:151-153`, no message); otherwise `alertConfirm("Do you really want to remove: <name>")`; then removes and selects index 0. No undo. Handles races carefully (`:154-173`).
- Reorder: drag only; destroys and recreates Sortable after each move (`:29-54`). Keyboard/touch reorder: none seen.

**Selection and binding.**
- Active persona: click grid icon (`changeUserPersona`), or the quick overlay `listedPersona` (name + " / note" rows, `listedPersona.svelte:27-39`), opened by hotkey `persona` Ctrl+E (`hotkey.ts:192-195`, store `openPersonaList`) and the Ctrl+` quick menu (`hotkey.ts` quickMenu sel===... `openPersonaList`), and custom sidebar item.
- Per-chat binding EXISTS: `chat.bindedPersona` (persona id) read in `lib/ChatScreens/DefaultChatScreen.svelte:372-375`, label "Bind Persona" in the chat-message alert menu (`lib/Others/AlertComp.svelte:766`), shown and clearable in `lib/SideBars/CustomSidebar.svelte:17-80` (shows bound name + note; clear sets `''`). Falls back to the global active persona. No per-character binding found.
- `embeddedModule` (a module carried inside a persona, resolved via id `$embedded` when the persona is bound, `ts/process/modules.ts` getModuleById) has no UI in PersonaSettings (INFERRED: set only by import/plugin paths).
- Prompt use: `personaPrompt` is parsed through the macro parser and injected in the `personaPrompt` prompt slot (`ts/process/index.svelte.ts:1001-1005`).

**Related settings elsewhere.** Advanced `personaNote` toggle (experimental), custom sidebar `persona` item, Loadouts store a persona (`today-settings.md` §5, `loadout.ts`), chat menu "Bind Persona".

**Limits.** No name length limit, no description length/token counter, no max persona count, no image size limit found in these files (OBSERVED by absence; `reencodeImage` on import may resize, not read).

## 3. Plugins (`lib/Setting/Pages/PluginSettings.svelte` 323, `ts/plugins/plugins.svelte.ts`, `pluginExport`, `pluginSettingsFile`, `apiV3/`)

**Data** `RisuPlugin` (`plugins.svelte.ts:46-60`): `name, displayName?, script, arguments {key:'int'|'string'|string[]}, realArg {key:value}, version?: 1|2|'2.1'|'3.0', customLink[{link, hoverText?}], argMeta {key:{name, description, placeholder, textarea, radio, checkbox, divider}}, versionOfPlugin?, updateURL?, enabled?, allowedIPC?`. Header comments parsed from the script: `//@name //@display-name //@api //@version //@arg //@link //@update-url` (`pluginListMerge.ts:70-91`, `pluginExport.test.ts:115-120`).

**List row** (flat card, no search, no count): bold `displayName ?? name`; amber "hot" badge if hot-reloading (dev); icons in this order: V2/V2.1 warning triangle, one link icon per http(s) `customLink` (hover text), an update "+" icon if update available, Export (download), Plugin settings file (only if V>1 and at least one non-`hidden_` arg), enable power/power-off, Trash. **Author, version number, description, permissions (`allowedIPC`) are never displayed** (OBSERVED: `versionOfPlugin` is not rendered). Row is a clickable `role=button` div that toggles the argument panel, containing nested buttons (INFERRED a11y problem; the toggle uses `e.preventDefault()` only, no `stopPropagation`, so clicking power/export also toggles the panel, except the remove/update ones that don't stop either: all nested clicks bubble). Enabled state shown only by icon swap (no label, no dimming).

**Install.** Only from local file(s): picker for `.js`/`.ts` (`importPluginFromPicker`, `plugins.svelte.ts:~160`); one file -> single path, 2+ -> batch review (`importPluginBatch`, `pluginBatch.ts`); `.ts` is transpiled; header and API-version checks refuse with reasons. No install-from-URL button; `updateURL` exists only for update. A "</>" button -> select: hot-reload import (dev mode: `hotReloadPluginFiles`, `apiV3/developMode`), download starter template (`/plugin_start.7z`; the code appends the anchor but never clicks it (`PluginSettings.svelte:311-316`), INFERRED broken), cancel. Plugins can also install other plugins (`handlePluginInstallViaPlugin`).
**Update.** `checkPluginUpdate` fetches `updateURL` on render for each row (cached in `updateCache`, `plugins.svelte.ts:82-120`), compares `//@version` text with `versionOfPlugin`, shows a green "+" icon; click -> confirm -> `updatePlugin`. No "check now", no "up to date" state, no changelog; a network failure is silent.
**Enable/disable.** `togglePluginEnabled` flips and calls `loadPlugins()` (reload scripts; `plugins.svelte.ts:393-399`). Enabling V2.1 clears restore strikes; after two failed restores V2.1 plugins are auto-disabled with a notice (`:402-420`).
**Plugin-defined settings.** Panel (expand the row) renders `arguments`: `string[]` -> select (note: option label is the literal letter "a", bug: `<OptionInput value={a}>a</OptionInput>`, `:217`); `'string'` -> text, textarea (`argMeta.textarea`), or radio group (`argMeta.radio` "label|value,..."); `'int'` -> number, checkbox (`argMeta.checkbox`, stored '1'/'0'), or radio. Per-arg `name`, `description`, `placeholder`, `divider` (section title or bare line). Args prefixed `hidden_` are skipped. Values are written straight to `realArg` on every keystroke (no apply, no reset to default, no validation, int values may be strings). V1 plugins show a red "needs API V3" line instead of args.
**Plugin settings file** (settings2 icon): `openPluginSettingsMenu` (`pluginSettingsFile.ts`) offers export/import of arg values as JSON (select/confirm/notify flow injected).
**Export.** `pluginExportFile` -> downloads `.js` with headers rebuilt (`pluginExport.ts`).
**Remove.** confirm "Do you really want to remove: <name>", clears `currentPluginProvider` if it was this plugin, `loadPlugins()`. No undo; plugin data stored by the plugin may remain.
**Security text today.** (a) Page-top red line "Installing malicious plugins can cause problems." (`en.ts:1251`), (b) per-row yellow triangle for V2/V2.1 -> markdown alert "considered unsafe ... Please do not use" (`en.ts:2027`), (c) V1 red line. Nothing shown for permissions/`allowedIPC`, nothing at install time in the picker path beyond header/API refusals (batch path has a review step; its text not read).
**API versions.** 1 (unsupported, listed with a red line, no arguments, still deletable/exportable), 2 and 2.1 (warning triangle; "Plugin 2.0 is removed" console warning at `plugins.svelte.ts:~1164` so V2 is likely non-functional, INFERRED; 2.1 still loads and can read/write live character list), '3.0' (normal; `apiV3` also adds `additionalSettingsMenu` entries, see today-settings.md §1).

## 4. Modules (`Module/ModuleSettings.svelte` 206, `ModuleMenu.svelte` 367, `ModuleChatMenu.svelte` 134, `ts/process/modules.ts`)

**Type** `RisuModule` (`modules.ts:30-46`): `name, description, id (uuid), namespace?, hideIcon?, lowLevelAccess?, customModuleToggle? (text; the custom-toggle DSL), backgroundEmbedding? (HTML), icon?, mcp? {url}, assets? [name, path, ext][], lorebook?, regex?, trigger?, cjs?`. `icon` and `cjs` have no editor field in these files.

**Library list** (`ModuleSettings.svelte` mode 0): title, name-only search (case-insensitive substring on `name`, `:28-33`; not description/namespace), single bordered list. Row: MCP waypoints icon if `mcp`; name; description line (or "No description provided"); icon buttons: **Globe** global enable (blue = on; amber = off but its namespace is listed in the preset's `moduleIntergration` text; grey = off) with tooltip "Enable Global" (`:82-100`), **Share** export, **Edit** pencil, **Trash**. For MCP rows export and edit are inert buttons, only visually "not-allowed" (no `disabled`, no label, `:124-129`). No count, no sort, no tags, no namespace/id/low-level/asset-count shown in the row; order = `db.modules` order, not reorderable. Footer icon-only buttons: Create (+), "Convert to character" (person icon toggles a mode in which every row's Globe/Share/Edit/Trash are replaced by a violet person icon), Import MCP (waypoints), Import file (upload). Icons have no text labels or aria-labels (tooltips only on some).
**Create.** `+` pushes a blank module (`name:'', description:'', new uuid`) onto `db.modules` immediately, then opens the editor (`:162-170`); the "Create module" button just closes it. INFERRED: cancelling or navigating away leaves a nameless module in the list (no cancel path). Edit mode shows the Save button only when `name !== ''`, and `tempModule = rmodule` aliases the live object, so typing edits live data (the "Edit module" button re-assigns the same object; no real draft/cancel). Closing bumps `ReloadGUIPointer` and `refreshModules()`.
**Import** (`importModule`, `modules.ts:650-690`): any file(s) routed by suffix `.risum`, `.charx`, `.json`, `.lorebook` (`:458-470`); multi-file batch with a summary; duplicate handling via `DuplicateSession`; low-level-access content asks for confirm first ("This content uses Low Level Access, which means this content can access the AI model and your storage directly. Do you really want to import this content?", `en.ts:1643-1644`; batch path reports `importDeclinedLowLevel`). Re-import with the same id replaces (`bumpModuleGui`); namespace-change notice string exists (`en.ts:2375`).
**MCP import** (`mcp.ts:427-`): modal input with a preset suggestion list (internal:aiaccess, risuai, fs, googlesearch, dice, graphmem; https PayPal, Linear, OneContext, Cloudflare Browser, DeepWiki), accepts http://localhost, 127.x, https:, internal:, stdio:, plugin: only; fetches server meta; creates a module named from `serverInfo.name`, description `"MCP from <url>"`, with an "MCP Info" lorebook entry. After creation there is no UI to see/edit the URL (INFERRED: only via the lorebook). No consent text about what an MCP server can do beyond the URL list (not read further).
**Export:** select between "CharX (recommended)" `.module` charx and legacy `.risum` (`ModuleSettings.svelte:102-111`, `modules.ts:48-134`). Export has no preview of included assets/size.
**Delete:** confirm "Do you really want to remove: <name>", then removes from `modules` and from `enabledModules`; per-chat/per-character enabled ids in characters are not cleaned (INFERRED: stale ids; `getModuleByIds` just ignores unknown). No undo.
**Convert to character:** `convertModuleToCharacter` pushes a character, toast only.

**Enablement layers** (OBSERVED):
1. Global: `db.enabledModules` (Globe in library).
2. Preset-text: `db.moduleIntergration` comma-separated namespaces (BotSettings Others > accordion, `BotSettings.svelte:791-792`); matched against `module.namespace` in `getModuleByIds` (`modules.ts:~700`). This is why `namespace` exists. Help text: advanced users, vary modules by presets (`en.ts:619-622`).
3. Per chat: `chat.modules`, per character: `character.modules`; edited in `ModuleChatMenu.svelte` (modal from the chat menu). Left click toggles chat (blue), **right-click / long-press** toggles character (violet) with no visible affordance except the info sentence (`en.ts:1564`). Globally enabled modules show disabled (greyed, inert) here. Search by name; footer "Edit" opens Settings page 14 (`:121-125`). `alertMode` reuses the modal as a single-module picker. No indication of which level the colour means beyond blue/violet.

**Editor tabs** (`ModuleMenu.svelte`, five buttons, `:197-243`) mapped:
| Tab | Anchor | Class |
|---|---|---|
| Basic info: name, description (single-line `size=sm`), namespace (+help), "Hide Icon UI" checkbox, "Custom Toggles" textarea (`customModuleToggle`) | `:245-257` | **Info**, except Custom Toggles which is the module's contents (toggle DSL shown in chat) |
| Lorebook | `:258-276` | contents (Studio) |
| Regex script (+ background HTML `backgroundEmbedding`) | `:278-292` | contents |
| Trigger script (+ **Low Level Access** checkbox at the bottom of this tab, `:361-368`) | `:361-368` | contents; but the lowLevelAccess flag is an info/permission field hidden here |
| Additional assets (add/rename/remove, optional previews via `db.useAdditionalAssetsPreview`) | `:294-359` | contents (assets); an asset count is info |
Info fields therefore are: name, description, namespace, hideIcon, lowLevelAccess, enable state (global/preset-namespace/chat/character), mcp url, id (not shown today), icon (not shown), asset/lore/regex/trigger counts (not shown).
**Warnings today:** low-level access only at import time and a tooltip help; nothing in the library list indicates which modules have it, which enabled ones can touch storage, or a module's trigger-only-works hint (`en.ts:triggerLowLevelOnly`).

## 5. Synthetic-data needs
- Hotkeys: 25 rows incl. 3 inert (modelSelect, toggleVoice, webcam), 1 hidden-by-setting; 7 Ctrl+Alt, 17 Ctrl, 1 bare Space; plus 9 fixed Ctrl+1..9 and Esc/Enter; include one user-made duplicate and one browser-reserved combo (Ctrl+W) for conflict states; a Mac layout variant.
- Personas: 5-8 entries; names mixed Korean/English (e.g. "기본", "Alex"), notes optional (`note` only when `personaNote` on), description 0-1500 chars (one empty), 3 with icon, 2 without, 1 `largePortrait`; one bound to 2 chats; a persona with `embeddedModule`.
- Plugins: 5-8 entries; versions '3.0' x4, '2.1' x1, 1 x1, one hot-reload badge; one with `updateURL` + newer version, one with 6-10 args (string, int, select, radio, checkbox, textarea, divider), one with only hidden_ args, one with customLink x2; `versionOfPlugin` like "1.2.3"; authors do not exist in data (a mockup showing author is a new field).
- Modules: 10-25 entries; names 4-40 chars; descriptions 0-200 chars (some empty); 3 with namespace; 1 `lowLevelAccess`; 1 `hideIcon`; 2 MCP (internal:dice, https://mcp.deepwiki.com/mcp); asset counts 0-40; lorebook 0-120, regex 0-15, triggers 0-8 entries; 2 globally enabled, 1 namespace-matched, 1 chat-enabled, 1 character-enabled; one with a customModuleToggle.

## 6. Pain points visible in code
1. Hotkey capture stores raw `e.key`; modifiers are separate unlabeled toggles; no conflict/duplicate/reserved check, no reset, no Cmd, Tab trap, three dead actions, hard-coded Ctrl+1..9/Esc invisible in the table, <768 px dead page, table has one header cell.
2. Persona grid has no names; Note label shown even when the field is hidden; remove silently does nothing when one persona left; typed edits reach the list lazily (working copy); new persona name is English literal; image replace changes `id` (breaks chat bindings, INFERRED); export drops `largePortrait` and requires non-empty name/description; no import preview, no select after import, `Check` of `largePortrait` has no preview of effect.
3. Plugin rows: no version/author/permission display, state is icon-only, nested buttons inside a `role=button` div (bubbling toggles the args panel), select options render the letter "a", template download anchor never clicked, update check silent on failure and no "check now", no install-from-URL, edits apply per keystroke with no reset, V1/V2 still listed with only a tooltip, warning copy is one sentence.
4. Module library: icon-only controls without aria-labels; inert MCP buttons not `disabled`; creating pushes an empty module immediately (orphan on abandon); edit aliases the live object (no cancel); delete leaves stale ids; search only by name; no namespace/low-level/MCP-URL/asset counts visible; "convert to character" is a hidden mode that swaps the row actions; right-click/long-press character-level enable is undiscoverable and impossible on keyboard; `lowLevelAccess` buried inside the Trigger tab; no module id/icon display.
5. English-only literals: "Ctrl/Shift/Alt", "SPACE", "New Persona", "New Lore", "New Folder", "New Event", plugin select "a", MCP preset labels ("LLM Call Client"), `language.*` used elsewhere so the rest is localised (ko exists for `hotkey`).

## 7. Open product questions
1. Hotkey rebinding: capture the full chord from one keypress (replacing the three toggles) with live conflict warnings, or keep toggles plus key but add conflict warnings? Should it block duplicates, warn only, or auto-swap?
2. Should Ctrl+1..9 become rebindable rows (and Esc/Enter stay fixed/listed read-only), shown read-only, or stay out of the page?
3. Dead actions (modelSelect, toggleVoice, webcam): hide, show as "not available", or wire them (needs main-session decision)?
4. Mac: map "Ctrl" to Cmd on Mac, support Cmd as an additional modifier, or leave as-is? Per-device overrides (hotkeys live in the synced db) or stay global?
5. Personas: is the name-less grid acceptable as a "gallery", or move to list/cards with name + note + bound-chat count? Should the editor become an explicit draft with Save/Revert (matches preset question) or stay live?
6. Persona image replace changes `id`: treat as a bug to fix in main session, or keep and hide behind the editor? Should export include `largePortrait`?
7. Plugins: show author/version/permissions (author does not exist in data; header `//@author`?) - add field, display version only, or show nothing new? Install-from-URL wanted?
8. Plugin safety: keep the generic warning, add a per-plugin "what it can access" line (API version + `allowedIPC`), or require a confirm on enable for V2/V2.1?
9. Module info page: surface `lowLevelAccess` as a badge + confirm-on-enable (only at import today)? Show namespace and id as copyable? Expose MCP URL as a read-only info field?
10. Module enablement: present the four layers (global, preset-namespace, character, chat) in the info page as a checklist, or keep global only there and leave character/chat to the chat menu?
11. Module creation: create-then-name (today) or create via a dialog that only adds on confirm; and should the Studio "Open in Studio" create the draft?
12. Deleting a module: keep confirm only, add count of chats/characters using it, or add undo toast?
13. Keep "convert module to character" in the library, or move to a module info-page action?
