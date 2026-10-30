# Today's authoring surfaces (discovery for Studio)

Date 2026-10-26. Source-read only (no app run, no screenshots). Paths are under `src/` unless noted. "Obs" = observed in source; "Prop" = candidate input for the designer, not a decision. Anything marked (unverified) was inferred and not traced to the end.

## 1. Inventory of authoring surfaces

| # | Surface | Entry from UI | Control / size | Fields | Owner / scope |
|---|---|---|---|---|---|
| 1 | Character editor `lib/SideBars/CharConfig.svelte` | Right sidebar (`Sidebar.svelte:344`; DevTool renders above it at :342 only if `db.enableDevTools`). Mobile: footer buttons `Mobile/MobileFooter.svelte:35-66` | Icon-only tab row (:213-241), content switched by store `CharConfigSubMenu` (`stores.svelte.ts:60`) | see 1a | One character or group (`DBState.db.characters[$selectedCharID]`) |
| 2 | Group editor bits (same file) | Same sidebar when `type === 'group'` | Tabs 4/5 hidden and forced back to 0 (:170) ; member checkboxes :299, `orderByOrder` :326 | members, order, group author note :312 | Group |
| 3 | Prompt/preset settings `lib/Setting/Pages/PromptSettings.svelte` | Settings > Bot/Preset (`BotSettings.svelte:736`, :867 inline); also `Settings.svelte:205` | `TextAreaInput` stacked in a long page (:288-299) | `customPromptTemplateToggle` :289, `templateDefaultVariables` :291, predicted output, auto-suggest, group template, system replacement | Global DB value that is copied into/out of the active preset (`storage/database.svelte.ts:2140` save, :2277 restore) |
| 4 | Prompt item editor (not read) | Preset settings | not read | | Preset |
| 5 | Preset regex | `BotSettings.svelte:807` `RegexList buttons` -> `db.presetRegex` | Same RegexList | | Preset |
| 6 | Module editor `Setting/Pages/Module/ModuleSettings.svelte` + `ModuleMenu.svelte` | Settings > Modules (`Settings.svelte:203`) or `Others/QuickSettingsGUI.svelte:27`; list row pencil (:114) | Own 5-button sub-tab row (ModuleMenu :198-241): basic info, lorebook, regex, trigger, assets | name, description, namespace (:246-251), `customModuleToggle` TextArea :256, lorebook list :259, `backgroundEmbedding` TextArea (size sm) :279, regex :280, trigger :362, assets :294-360, low-level access :366 | Module (global enable via globe icon :82, or per chat/char) |
| 7 | Lorebook editor `SideBars/LoreBook/*` | Char editor tab 3 (:677); module tab; | `LoreBookSetting` 3 segments (:50-66): character/group, Chat, Settings; entries are accordions with sortable folders (`LoreBookData.svelte`) | comment, key, secondkey (if selective), content TextArea (:268), alwaysActive, per-chat active (:279), selective, useRegex (:282-291), folder | Character, chat-local, or module (`externalLoreBooks` prop); no global list found in this component |
| 8 | Regex scripts `Scripts/RegexList.svelte` + `RegexData.svelte` | Char tab 4 (:691); module; preset | Accordion row per script (RegexData :84-171) | name, type select (6 values :117-126), `in` single-line TextInput :128, `out` TextArea sm :130, flags behind "custom flag" checkbox (:133-168; 10 flags, order number) | Character, module, preset (3 places, same component) |
| 9 | Trigger scripts `Scripts/TriggerList.svelte` | Char tab 4 (:714); module tab (:362) | One mutually exclusive mode per list: V1 / V2 / Lua buttons (:28-93). Switching confirms and wipes the list (:39, :54, :82). V1 button hidden unless `showDeprecatedTriggerV1`. | Lua mode: one TextArea default height, `popupLanguage="lua"` (:98). V2: `TriggerV2List.svelte` (4096 lines): event list + effect list + detail pane (:2388-2950), up to 19 TextAreaInputs in the detail pane (:2950-3913). V1: `TriggerV1Data.svelte` 507 lines | Character, module |
| 10 | Lua | The Lua mode of #9 only | single TextArea + "help" button opening hub docs URL (:99-101) | code | Character, module |
| 11 | Background embedding / display HTML | Char tab 4 `backgroundHTML` (:688), module `backgroundEmbedding` (ModuleMenu :279) | TextArea default / size sm | HTML | Character, module |
| 12 | `virtualscript` (legacy JS) | Char tab 4 (:718), only if already set or `showUnrecommended` | TextArea | JS | Character |
| 13 | Plugins `Setting/Pages/PluginSettings.svelte` | Settings > Plugin | List with per-plugin argument inputs (:197-260, `TextAreaInput` only for `argMeta.textarea` :222); import/update/blank (`createBlankPlugin`, imports :8) ; hot-reload import option (:303) | Plugin code is NOT edited in this page (obs: no code editor found; import from file) | Global |
| 14 | PopupEditor `Others/PopupEditor.svelte` + `MonacoEditor.svelte` | Not a button. Opens from any `TextAreaInput` via hotkey `popupEditor` (TextAreaInput :70-73) or right-click when `db.longPressToPopupEditor` (:91-92). Mounted in `App.svelte`. | Overlay w-11/12 h-11/12 (PopupEditor :55); Monaco, theme fixed vs-dark (:119); Markdown/CBS preview mode with token count and a Toggles side panel (:63-116) | one string | Whatever field launched it |
| 15 | Toggle sidebar consumer `SideBars/Toggles.svelte` | Chat screen | not an authoring surface; renders merged definitions | | |
| 16 | Character-level misc in tab 2 (`CharConfig` :1054-1283) | | ~25 TextAreas incl. example message, system prompt, replaceGlobalNote, additionalText, personality, scenario, `defaultVariables` :1130, translatorNote, `customModuleToggle` :1136, alt greetings :1179, supermemory data :1251 | | Character |

### 1a. Character editor tabs (`CharConfig.svelte`, store `CharConfigSubMenu`)

| Id | Tab (icon only on desktop) | Visible when | Content | Lines |
|---|---|---|---|---|
| 0 | Basic (user icon) | always | name, description (highlight TextArea), first message, group fields, author note, token counts under each | 244-334 |
| 1 | Display (smile icon) | always | sub-toggle `viewSubMenu` 0/1 (:349-358): portrait/emotion images and image generation prompts, additional assets list | 335-676 |
| 3 | Lorebook (book) | always | LoreBookSetting | 677-681 |
| 5 | Voice/TTS (volume) | `type==='character'` | provider specific forms | 750-1053 |
| 4 | Scripts (braces) | `type==='character'` | backgroundHTML, regex, trigger, virtualscript | 682-722 |
| 2 | Advanced (activity) | always | example msg through bias, alt greetings, low-level access flags, supermemory | 1054-1283 |
| 6 | Share (share icon) | `type==='character'` | realm upload, export, remove | 723-748 |

Obs: tab ids are not in visual order (0,1,3,5,4,2,6). Tab labels are icons only (no text, no tooltip seen in :215-238). On desktop the row is hidden when `licensed === 'private'` or `$MobileGUI`.

Sizing: 7 tabs; about 60 TextAreaInput/TextInput usages in CharConfig alone, of which 20 are multi-line TextAreas (grep of `TextAreaInput` hits at lines 248-1278). Highlight (CBS colouring) is set on `highlight` TextAreas only: description, first message, example message, system prompt, replaceGlobalNote, additionalText, personality, scenario, alt greetings, backgroundHTML, image-gen prompts; plain on defaultVariables, translatorNote, toggle definitions, virtualscript, Lua, supermemory.

### 1b. How many places can the same kind of thing live

| Kind | Places (obs) |
|---|---|
| Toggle definitions | 3 text fields: preset/global (`PromptSettings:289`), each module (`ModuleMenu:256`), character (`CharConfig:1136`) |
| Default variables | preset (`PromptSettings:291`), character (`CharConfig:1130`); character wins on name clash per help text `lang/en.ts:601` |
| Regex scripts | character, each module, preset (`presetRegex`) |
| Trigger / Lua | character, each module |
| Lorebook | character/group, chat-local, module (`LoreBookData` is shared) |
| Background HTML | character, module |
| Code with no in-app editor | plugins |

Obs: the same `RegexList` / `TriggerList` / `LoreBookList` components are reused in all hosts, so a redesigned component propagates to all scopes; the host supplies only the bound array and a scope title.

## 2. Saving model

| Aspect | Observation | Anchor |
|---|---|---|
| Character, preset, global fields | Direct two-way `bind:` onto `DBState.db...`; no draft layer and no Save button | CharConfig :248 etc.; PromptSettings :289 |
| Persistence | Change effects mark the DB dirty and a debounced scheduler runs `saveDb()` (several-hundred-ms to multi-second sleeps in the loop, e.g. `globalApi.svelte.ts:2105`, :2392); multi-tab peer-save detection and "save mine"/reload prompts exist | `globalApi.svelte.ts:1531-1613`, `storage/saveScheduler.ts` |
| Save feedback in the authoring UI | None seen in any editor component read. Failure/peer prompts come from the global save loop, not from the field being edited (not traced to UI; unverified). | |
| Module edit | `tempModule = rmodule` is the same reference as the DB entry (ModuleSettings :117), so edits are live; the final "Edit module" button re-assigns the same object and closes (:202-205). Hidden when name is empty (:201). No cancel/discard. | `ModuleSettings.svelte:114-122, :189-206` |
| Module create | The "+" pushes the blank module into `db.modules` before the user fills anything (:163-169); the "Create module" button only closes the editor (:192-197). Abandoning leaves a nameless module. | |
| Module refresh | Chat reload happens on close/destroy (`refreshModules`, `$ReloadGUIPointer`) | :37-47 |
| Regex/trigger | Live bind; `$ReloadGUIPointer += 1` on some regex inputs (RegexData :114, :131) to refresh the chat view | |
| Trigger mode switch | Confirm dialog, then list replaced (data loss by design) | `TriggerList.svelte:35-39` |
| Popup editor | Text is copied to `popUpEditorStore.value`, edited in Monaco, written back to the field when the overlay closes (TextAreaInput :82-88 polling loop); backdrop click closes (PopupEditor :52). No Cancel: close always commits. | |
| Undo | Native textarea undo only; no document-level undo found. Remove actions use `alertConfirm` (RegexData :99). | |
| Validation on save | None found for toggle syntax (parser silently drops bad lines, util.ts:798-820), regex `in`, or Lua. V1 triggers show a static deprecation warning (TriggerList :94-96). | |
| Draft / recovery | None found in these components. (Design mockups propose it: see section 6.) | |

## 3. Test / debug affordances today

| Affordance | Where | Notes |
|---|---|---|
| Dev tool panel | `SideBars/DevTool.svelte`, shown above the character editor only when `db.enableDevTools` (`Sidebar.svelte:331-342`) | Accordions: chat script variables editor (:33-50), token counts (:52-83), autopilot batch sender (:85-138), prompt preview (:141-167 via `runPreviewPrompt`), lorebook test and "match sources" table (:169-201, uses `loadLoreBookV3Prompt` matchLog), module list (:203-211), request log (:213-215). Output shown via `alertMd` modal. |
| Popup editor preview | PopupEditor :17-28, :91-116 | Runs `risuChatParser` on the text, shows result, token count, and the Toggles panel to flip values while previewing. Only for Markdown/CBS mode. |
| V2 trigger "v2RegexTest" effect | TriggerV2List :1257, :3769 | A runtime effect inside a script, not a tester. |
| Regex preview | none found in RegexData | |
| Trigger run/test button | none found in TriggerList / V1 / V2 list (grep for test/run in TriggerV1Data found none) | |
| Lua errors / log | `process/triggers.ts` has only 3 error/log call sites (count); no in-editor Lua console seen | (unverified beyond count) |
| Plugin console | none in PluginSettings; plugin dev loop is hot-reload import (:303) | |
| Variables inspector | DevTool scriptstate only (obs :35) | |

## 4. Toggle definition

Syntax parsed by `parseToggleSyntax` (`ts/util.ts:788-828`): one entry per line, `key=label[=type[=options]]`, split on `=` and `,`.

| `type` | Result (util.ts) | Rendered in `Toggles.svelte` |
|---|---|---|
| (omitted / unknown) | checkbox; options `[]` (:813-820) | CheckInput :170 stores '1'/'0' |
| `select` | `options` = comma split (:818) | SelectInput, stores index string (:128-133) |
| `text`, `textarea` | single/multi-line | TextInput :136; TextAreaInput height 20 :143 |
| `group` / `groupEnd` | nesting marker, `children` (:800-806) | Accordion :119; reducer :77-92 |
| `divider` | label optional | `<hr>` :159 |
| `caption` | requires `value` (:807) | small text :155 |

Obs constraints: a literal `=` or `,` in a label/option cannot be expressed (no escaping); lines without key+value are silently skipped; duplicate keys are not detected; `groupEnd` needs a line with key and value only through the first branch (its `value` is stored but unused).

| Edit site | Control | Help text |
|---|---|---|
| Preset/global `PromptSettings.svelte:288-289` -> `db.customPromptTemplateToggle` | `TextAreaInput` default height | `Help key=customPromptTemplateToggle` (`lang/en.ts:599-600`): documents only `<toggle variable>=<toggle name>` and `{{getglobalvar::toggle_<var>}}`; type/select/group/divider/caption syntax is NOT mentioned (obs) |
| Module `ModuleMenu.svelte:255-256` -> `module.customModuleToggle` | same | same key |
| Character `CharConfig.svelte:1135-1136` -> `character.customModuleToggle` | same | same key |
| Popup editor | Toggles panel is a consumer, not editor | |

Merge: `Toggles.svelte:70-75` concatenates `db.customPromptTemplateToggle + modules + character` text; `getModuleToggles` (`process/modules.ts:819-831`) concatenates enabled modules' text. The sidebar does not show which source produced a toggle (obs; only a pin icon for locally set values :104-111). Same key defined twice is not reported. Values live in global chat variable `toggle_<key>`; `useLocallySetGlobalVariables` per chat (:215-221) pins them to the chat. Also used in `process/index.svelte.ts:678` and exported with character cards (`characterCards.ts:2075`, imported :1428 as `extensions.risuai.toggles`, which defaults to `{}` object though the field is a string, existing oddity).

## 5. Sizing and depth

| Item | Obs |
|---|---|
| TextAreaInput height | Fixed: class `h-40 min-h-40` at default size 0, adjustable only through global setting `textAreaSize` (-5..5 -> h-20..h-60), `resize-none` on the inner textarea (`UI/GUI/TextAreaInput.svelte:9-31, :43`). Per-use `height` prop supports 20-36 or `full`; hardly any call site sets `full`. Text size also global (`textAreaTextSize`). So 160 px (default) for description, Lua, HTML, toggles, lorebook content. |
| Escape hatch | Hidden popup editor (hotkey or right-click setting) |
| Clicks from chat to a character script editor | Open sidebar (1, if closed) -> Scripts tab (1) -> expand regex row (1) = about 2-3; triggers V2: tab + select event + select effect (about 3-4, detail pane is a third column inside a narrow sidebar, TriggerV2List :2388 `md:flex-row`) |
| Module regex | Settings (1-2) -> Modules (1) -> pencil (1) -> Regex tab (1) -> row (1) = about 5; the module may be not enabled for this chat, so the effect on current chat is indirect |
| Toggle definitions | Preset: Settings > Bot > Prompt settings scroll; module: 4-5 clicks; character: Advanced tab + scroll (:1136 is deep in a ~230-line tab) |
| Ownership discovery | No cross-scope view. To find which owner holds a script a user must visit character tab 4, every module editor, the preset regex list and (for toggles) all three text fields. Module list shows names and descriptions only (ModuleSettings :154-156). |
| Phone | Character tabs move to the footer (`MobileFooter`: 6 buttons); V2 trigger editor uses stacked `flex-col-reverse`, `h-svh` panes (TriggerV2List :2388, :2586) |

## 6. Existing design inputs

| Source | What it decides / proposes about Studio | Conflict or gap vs maintainer's new scope |
|---|---|---|
| `docs/design/mockups/studio.html` (4023 lines) | One document editor. Mode tabs CBS / Lua trigger / Plugin v3 (:457-459). Views Editor / Problems / Test / Target / Examples (:497-501); `.workspace[data-view]` panes (:147-150, 415-416); desktop shows several panes, narrow screens one view at a time (:2746). Panels: Problems :598, Test (simulated) :615, Target-apply :636, Examples :645. Mockup-only: scratch docs, session-parked draft, `?from=home&mode&return` | It models code (CBS/Lua/plugin), not structured forms, character fields, lorebook or toggles. No owner tree/ browser, which is the "find who owns it" pain. Target = apply to one owner. |
| `DEFERRED_TBD.md` section 1 (:9-32) | Open items: multiple named documents with owner/scope (ST-06, Decision TBD), save/recovery/apply semantics (ST-03, Decision TBD), Test as action vs live (Decision TBD), real diagnostics (ST-13), live scan vs Check stamp, indent defaults, screen-reader pass (ST-12), return route UX-01 (:38). Integration seam: reuse `MonacoEditor`, `PopupEditor`, `cbsMonaco.ts`, `luaMonaco.ts`, `pluginListMerge.ts`, `risuai.d.ts` (:32) | ST-06 and ST-03 are exactly the new pain points (find owner; saving unclear) and are now in scope via DD-089/090. |
| `completion-plan/02-library-and-authoring.md` | Character editor and lorebook/automation subviews with "Edit in Studio" hand-offs for description (N05.2 :86), trigger code (N05.A5 :128), lorebook content (:63, :144). Regex/automation fixtures (:130); lore fixtures and scope (:169). States "Module automation in N11 reuses this subview with module scope rather than forcing structured rules into Studio" (:130) | **Conflict:** maintainer's scope puts structured forms (toggles, regex, triggers, lorebook) and the character editor inside Studio, whereas 02 keeps them in Library surfaces and sends only code/long text to Studio. Needs a reconciliation decision. |
| `completion-plan/03-settings-and-connections.md` E03 (:196-233) and module detail (:168) | Target/revision/diff/conflict contract (E03.1-E03.6): Save draft, Check, Test (simulated), review diff, Apply with expected-revision, conflict view, recovery banner, return focus to originating field. Module detail "code opens E03" (:168-169) | E03 assumes Apply-to-target semantics for code documents. Maintainer scope has live structured forms where an Apply step may or may not fit; unresolved. |
| `DECISIONS.md` DD-089..092 (:641-665) | pain points all four; full authoring in slices; toggle list builder + text view; build on studio.html | Consistent with this report. |
| `tasks/2026-10-26-studio.md` | records the same, inputs list | |
| Not opened here | `reviews/2026-10-17-studio-*.md`, `AUDIT_RESPONSE.md` "Studio", chat `TOGGLES_SPEC` | read before the toggle-builder preview work |

## Gaps / not read

- No runtime or screenshot pass; row heights, sidebar widths and click counts are estimates from source.
- Not read: prompt item editor (preset list), `BotSettings` structure, group-chat-specific forms beyond :299-326, TTS tab details, `RegexList.svelte`/`LoreBookList.svelte` (518 lines) behavior (sorting, import/export), `TriggerV1Data`/`TriggerV2List` effect type catalogue (about 60+ effect cases), `triggers.ts` error handling and Lua VM output route, `pluginSettingsFile`/`developMode.ts` hot reload, global "Settings > regex" locations, save-loop UI prompts (`alert` flows), `MonacoEditor.svelte` (112 lines) language configuration, `cbsMonaco.ts`/`luaMonaco.ts`.
- Whether a global (non-character) lorebook list exists was not confirmed in `LoreBookList.svelte`; `LoreBookSetting` submenu 0 is labeled character/group.
- Mobile layout for CharConfig tabs was read only through footer buttons.
- Whether `Help` popovers or tooltips label the icon-only tab row was not checked.
- Plugin v3 scope: PluginSettings shows no source editor; the existing `studio.html` "Plugin" mode is therefore a net-new capability and its integration target is unresolved.

## Candidate slice boundaries (observations of natural seams, not decisions)

1. Shell and ownership map: tree/search of character, modules, preset, plugins, with scope badges. Seam: today's scatter (section 1b) and the missing cross-scope view. No existing component to replace.
2. Toggle list builder plus text view with live preview of the chat Toggles panel. Seam: self-contained parser (`util.ts:788`), three identical host fields, one consumer (`Toggles.svelte`). Includes merge/duplicate/source view (section 4).
3. Long-text field editor (description, first messages, alt greetings, prompts, HTML): replaces fixed 160 px boxes; seam is the single `TextAreaInput` plus hidden popup editor.
4. Character editor forms (Basic, Display and assets, Advanced, Voice, Share): section 1a tab list is the seam; Voice and Share are mostly settings and could be deferred.
5. Regex scripts: one `RegexList`/`RegexData` pair reused in three scopes; adds test sample (none today).
6. Lorebook: `LoreBookList`/`LoreBookData` reused in character and module; has an existing match log (DevTool :169) to build on.
7. Triggers V2 and Lua code: the heaviest surface (4096-line component, mutually exclusive V1/V2/Lua, wiping switch). Overlaps most with existing studio.html code editing and E03 apply/test.
8. Save/draft/test infrastructure: dirty indicator, revert, recovery, test runner panel. Cross-cuts all slices; today saving is global autosave with no per-field state, modules edit by live reference.
