# Long-text editing today (discovery for the Studio long-text slice)

Date 2026-10-26. Source-read only: no app run, no device, no screenshots. Paths are under `src/` unless noted. "Obs" = observed in source; "Prop" = candidate for the designer, not a decision. Builds on `docs/design/studio/research/today-authoring.md` (sections 1, 2, 5); not repeated here. Maintainer pain point DD-089: "cramped text boxes".

## 0. Headline findings (read these first)

| # | Finding | Anchor |
|---|---|---|
| H1 | CBS highlighting in fields is effectively OFF. `TextAreaInput` renders the contenteditable highlight branch only when `highlight && !$disableHighlight`; `disableHighlight` is `writable(true)` and nothing in `src/` ever sets it to false (grep: only the declaration, the read, and test mocks). So every `highlight` field is a plain `<textarea>` in practice. | `ts/stores.svelte.ts:131`; `lib/UI/GUI/TextAreaInput.svelte:41` |
| H2 | The highlighter, macro list and autocomplete in `TextAreaInput` are therefore dormant code, not current behaviour. Authors see no CBS colouring and no `{{` autocomplete in field boxes today. | `ts/gui/highlight.ts`; `TextAreaInput.svelte:193-234` |
| H3 | The popup editor's "CBS" mode is disabled in its own dropdown, and `registerCBSMonaco()` is an empty function. Monaco only gets Markdown or `lua` (`popupLanguage="lua"`, set by one call site). No CBS tokenizer/completion exists in Monaco today. | `Others/PopupEditor.svelte:70`; `ts/gui/codearea/cbsMonaco.ts:22-24`; `SideBars/Scripts/TriggerList.svelte:98` |
| H4 | Fields are fixed-height boxes (default 160 px, `resize-none`, internal scroll). There is no auto-grow in `TextAreaInput`. The only auto-grow textarea is `TextAreaResizable`, used for chat message editing (`ChatScreens/Chat.svelte:35`). | `TextAreaInput.svelte:14,26,43`; `UI/GUI/TextAreaResizable.svelte:24-35` |
| H5 | The popup editor has no Cancel: closing (X or backdrop click) always commits. The write-back to the field is a 100 ms polling loop, so an edit made while the popup is open is lost if the field component unmounts first. | `PopupEditor.svelte:52,84`; `TextAreaInput.svelte:82-88` and `:100-106` |
| H6 | Token counts exist for only three character fields (description, first message, per-chat author note) plus lorebook entry content and the popup preview. System prompt, example messages, alternate greetings, scenario, personality and all preset/module/regex fields show no count. | `SideBars/CharConfig.svelte:249,252,319`; `LoreBook/LoreBookData.svelte:269-273` |

## 1. Inventory of long-text fields

Common to all rows: control is `TextAreaInput` (default 160 px) unless stated; "hl" = passes `highlight` (inert per H1); all rows reachable via popup editor (hotkey/long-press) because that is built into `TextAreaInput`. Tokens column = a count is shown beside the field.

### 1a. Character (`SideBars/CharConfig.svelte`; owner = `DBState.db.characters[$selectedCharID]`)

| Field | Line | hl | Tokens | Syntax / notes |
|---|---|---|---|---|
| Description `desc` | 248 | yes | yes (:249) | CBS. Count runs `tokenizeAccurate`, i.e. after CBS parse. Typically the longest field (no size hint in code). |
| First message `firstMessage` | 251 | yes | yes (:252) | CBS, Markdown/HTML rendered in chat. |
| Author note (per chat) `chats[chatPage].note` | 312-317 | yes | yes (:319) | Owner is the chat, not the character. Placeholder = `getAuthorNoteDefaultText()`. Help key `chatNote` ("memory or UJB"). |
| Example messages `exampleMessage` | 1104 | yes | no | Convention in help text: `<START>` line starts each conversation, `{{user}}: ...` / `{{char}}: ...` turns (`lang/en.ts:525-529`). The `<START>` marker is documented in help only; the field has no structure. (Prompt-side splitting not traced.) |
| Creator notes `creatorNotes` | 1107 | n/a | no | `MultiLangInput` (per-language map), not a TextAreaInput; not read in this pass. Help: not sent to the prompt (`en.ts:530`). |
| System prompt `systemPrompt` | 1112 | yes | no | Replaces preset main prompt when non-empty (`en.ts:531`). |
| Global note replacement `replaceGlobalNote` | 1115 | yes | no | Replaces preset global note when non-empty (`en.ts:539`). The code name is "replaceGlobalNote"; UI label "Global Note Replacement" (`en.ts:1340`). No separate "post-history/jailbreak replacement" field was found on the character: jailbreak lives at preset level (1d). |
| Additional description `additionalText` | 1118 | yes | no | Help: "Separate with double newlines" (`en.ts:544`), a structure that is only prose. |
| Personality | 1122 | yes | no | Shown only if `showUnrecommended` or length > 3; help marks "not recommended". |
| Scenario | 1126 | yes | no | Same gating as personality. |
| Default variables `defaultVariables` | 1130 | no | no | `key=value` lines (help `en.ts:601`). Character wins over preset on clash. |
| Translator note `translatorNote` | 1133 | no | no | Plain. |
| Toggle definitions `customModuleToggle` | 1136 | no | no | `key=label=type=options` per line; see today-authoring section 4. Slice 2 owns the structured builder. |
| Alternate first messages `alternateGreetings[]` | 1179 | yes | no | A list: table row per greeting, `fullwidth` textarea in a table cell (:1176-1180), up/down/delete buttons per row (:1183-1189), "+" in the header (:1166). Each box 160 px tall inside a table cell inside a sidebar. |
| Background HTML `backgroundHTML` | 689 | yes | no | HTML/Markdown plus `{{bg::}}`, `{{audio::}}` (`en.ts:540-543`). Highlight is the CBS parser, which does not understand HTML. |
| Legacy JS `virtualscript` | 720 | no | no | Plain; gated (today-authoring #12). |
| Image-gen prompts (`newGenData.prompt/negative/instructions/emotionInstructions`) | 545-569 | yes | no | Display tab. |
| Supermemory data | 1251, 1278 | no | no | Per chat; two copies in two branches. |
| TTS prompt (gptSoVits) | 984 | no | no | Plain; not authoring prose. |

### 1b. Other owners

| Owner / field | Anchor | hl | Tokens | Notes |
|---|---|---|---|---|
| Lorebook entry content | `LoreBook/LoreBookData.svelte:268` | yes | yes (:269-273, `tokenizeAccurate`) | Host is an accordion row inside the lorebook list. Decorators (`@@depth`, `@@activate_only_after`, ...) are recognised only by the dormant highlighter (`ts/gui/highlight.ts:169-173`). Owner: character, chat-local or module. |
| Regex `out` | `Scripts/RegexData.svelte:130` | yes | no | `size="sm"`; `in` is a single-line TextInput (:128). |
| Trigger V1 effect values | `TriggerV1Data.svelte:361-475` | yes | no | Many one-line-ish values in 160 px boxes. |
| Trigger V2 detail values | `TriggerV2List.svelte:2950-3913` | yes | no | About 12 `highlight` boxes (grep), up to 19 total (today-authoring #9). |
| Trigger Lua code | `TriggerList.svelte:98` | no | no | Only call site passing `popupLanguage="lua"`; popup then shows Monaco in Lua mode with no Preview button. |
| Preset prompt item `text` (plain/jailbreak/cot) and `chatML` | `UI/PromptDataItem.svelte:294,304` | yes | no | `{{slot}}` is the default `innerFormat` (:351). `innerFormat` box :356, hl. Prompt items live in a list; each type shows different fields. |
| Preset main prompt / jailbreak / global note | `Setting/Pages/BotSettings.svelte:853,856,859` | no | no | `height="32"` (128 px), `fullwidth`. The one place a smaller box is chosen on purpose. |
| Module integration text | `BotSettings.svelte:792` | no | no | `height="32"`. |
| Preset toggles / default vars | `Setting/Pages/PromptSettings.svelte:289,291` | no | no | Default 160 px. |
| Module background embedding / toggles | `Module/ModuleMenu.svelte:256,279` | no | no | See today-authoring #6. |
| Persona prompt | `Setting/Pages/PersonaSettings.svelte:145` | no | no | Single global `db.personaPrompt` here; placeholder `settingsPage.personaPromptPlaceholder`. Per-persona name/icon handled elsewhere (not read). |
| Chat message edit | `ChatScreens/Chat.svelte:35` uses `TextAreaResizable` | no | no | Auto-grow `textarea`; sets `font-size`/`line-height` from `db.zoomsize`/`db.lineHeight` (:48-49). Different control family from field boxes. |
| Playground syntax | `Playground/PlaygroundSyntax.svelte:24` | yes | no | `optimaizedInput={false}`; the only caller that disables the 10-keystroke batching. |

Obs: no field distinguishes "short" from "long" in code; box size is the same 160 px for a 5-line toggle list and a 4 000-token description. No typical-size hint exists anywhere in source (no max length, no counter limit, no placeholder guidance). Typical sizes need maintainer data (Q1).

## 2. TextAreaInput (`UI/GUI/TextAreaInput.svelte`, 350 lines)

| Aspect | Observation | Anchor |
|---|---|---|
| Sizing | Wrapper div gets `h-*` and `min-h-*` Tailwind classes from `height` prop or global `textAreaSize` (-5..5). Defaults h-40/min-h-40. Note the min-h ladder (`min-h-48..80` for sizes 1-5) does not match the h ladder (`h-44..60`), so at size 3-5 min-height exceeds height. The inner textarea is `absolute top-0 left-0 w-full h-full resize-none overflow-y-auto`: it never changes the wrapper height. No drag handle. | :9-31, :43 |
| Global sizing settings | `db.textAreaSize` and `db.textAreaTextSize`, both integers -5..5 / 0-3; stored via `updateGuisize()`; labels "Input Area Size", "Input Area Text Size". Text size ladder xs, sm, md, lg for 0..3 (default text-xs = 12 px). A per-prop `size` can override. | `ts/gui/guisize.ts:4-18`; `setting/displaySettingsData.svelte.ts:170-186`; `TextAreaInput.svelte:3-7` |
| Default text size | Default is `text-xs` when `textAreaTextSize` is 0 (class `text-xs` at :7). Text is small by default on a long-prose field. | :7 |
| Highlight mode (dormant) | Switches to `<div contenteditable="true" bind:textContent>` with `translate="no"`, `white-space: pre-wrap`. Colouring uses the CSS Custom Highlight API (`CSS.highlights`, `Highlight`, `Range`), not overlay spans or a second layer. Early-returns if `!CSS.highlights`. Re-runs on every value change after `await sleep(1)`: walks all text nodes, concatenates text, lower-cases it, runs the parser plus 3 regexes, rebuilds ranges for every field in a global `Map`, and re-creates a `Highlight` per type for ALL live fields. Cost grows with number of highlight fields alive, not only the focused one. | `highlight.ts:9-115`; `TextAreaInput.svelte:279-290,346-348` |
| Highlight styling | The `::highlight(cbsnest0..4, cbsdisplay, deprecated, decorator, comment)` rules were not located in this pass (CSS not searched). | not read |
| contenteditable hacks | Enter is intercepted and replaced by `insertTextAtSelection('\n')` that rewrites `div.textContent` wholesale and resets the selection (:292-341). `\r` stripped. Paste is not handled specially (`insertContent` has a `'paste'` type that is never called). | :313-341 |
| Autocomplete (dormant) | On `input`, finds the text after the last `{{` before the caret, filters `AllCBS` by `startsWith`, shows up to 10 items in a small absolutely-positioned list, Enter/Tab inserts, ArrowUp/Down navigates, Escape hides. Disabled on mobile (`if(isMobile) return`). Inserted text: `{{name}}`, `{{name:` for entries ending `:`, `{{#if ` for block names. No arguments or docs shown. | :193-277 |
| Mobile | `isMobile` is a UA regex (`/Android\|iPhone\|iPad\|iPod\|webOS/`); in this file it only turns autocomplete off. No other mobile branch (no keyboard resize, no safe-area). | `ts/platform.ts:22`; `TextAreaInput.svelte:194` |
| IME | No `compositionstart/end` handling anywhere in `TextAreaInput`. In the textarea branch, `bind:value` plus `oninput` sets `value` on every input event, including mid-composition. In the contenteditable branch (dormant) `keydown` Enter is hard-intercepted, which breaks Enter used to confirm an IME candidate (obs by reading; unverified at runtime). | :50-62, :115-118 |
| Batching | `optimaizedInput` (default true): the textarea branch writes `value` back only every 11th `input` event and on `change` (blur/commit). `onInput` callbacks fire on the same cadence. Consequence: bound DB value lags typing by up to 10 keystrokes; token counters and anything bound to `value` update late. | :51-62 |
| Spellcheck / autocorrect | No `spellcheck`, `autocorrect`, `autocapitalize` attributes in `TextAreaInput` or `TextAreaResizable` (grep over `src/lib/UI/GUI`). Browser defaults apply. | grep |
| Find/replace, wrap | None in field boxes (browser textarea wraps by default; no line numbers). | |
| Undo | Native textarea undo only. The contenteditable branch rewrites `textContent` on Enter, which resets the native undo stack for that field (obs by reading; unverified). | |
| RTL | No `dir` attributes anywhere in the component (grep within file). Not otherwise handled. | |
| Popup launch | Ctrl+X by default (`defaulthotkeys.ts:136-140`, `action: 'popupEditor'`) when the textarea is focused; modifiers must include Ctrl/Shift/Alt. Right-click (`contextmenu`) when `db.longPressToPopupEditor` (default false, `database.svelte.ts:732`, setting `acc.longPressToPopupEditor` in `setting/accessibilitySettingsData.ts:69`). It only works in the plain-textarea branch (the handlers sit on the textarea element, not on the contenteditable div). No visible button, hint or affordance in the field. | `TextAreaInput.svelte:70-108` |

## 3. Popup editor and Monaco

| Aspect | Observation | Anchor |
|---|---|---|
| Mount | `App.svelte:266` renders `<PopupEditor/>` while `popUpEditorStore.open`. Store: `{open, value, mode:'default', language}` (`stores.svelte.ts:166-171`). | |
| Layout | Fixed full-viewport scrim `bg-black/50 backdrop-blur-sm`; panel `w-11/12 h-11/12 p-4` (≈92% x 92%). Header: title "Popup Editor", language select (Markdown; CBS option `disabled`), Preview/Edit button, red "X". No field name/owner/label, no token count in edit mode, no revert. | `PopupEditor.svelte:50-89` |
| Opening | Value copied into store; field waits (poll 100 ms) for `open=false`, then writes `store.value` back and calls `onInput()`. | `TextAreaInput.svelte:76-88` |
| Monaco loading | `import('./MonacoEditor.svelte')` in `onMount`; "Loading" text until it resolves. Monaco and four language workers (json, css, html, ts) plus the editor worker are bundled with `?worker` imports; the packages `monaco-editor ^0.57.0` (`package.json:72`). Chunk-size warning limit raised to 2000 kB (`vite.config.ts:44`), a hint that large chunks exist. Actual sizes were not measured (no build run). | `PopupEditor.svelte:41-45`; `MonacoEditor.svelte:1-35` |
| Monaco options | `wordWrap:'on'`, line numbers on, minimap off, `fontSize:14` fixed, mono font stack, theme fixed `vs-dark` from caller, `automaticLayout`, scrollbars 6 px. No app setting is read (no text size, theme, font, wrap). `readOnly` prop exists. | `MonacoEditor.svelte:61-80` |
| Languages | Markdown (default) and any `popupLanguage` string; only `'lua'` is passed (TriggerList :98). `registerLuaMonaco()` adds Lua completions (`luaMonaco.ts`: global/stdlib items). `registerCBSMonaco()` body is empty; `getMacroData()` in the same file builds a macro dictionary from `registerCBS` but nothing calls it. | `cbsMonaco.ts:3-24` |
| Preview mode | Only for `markdown`/`cbs`. Runs `risuChatParser(value)` (reactive `$derived`) on every store change, shows the result in `<pre>` (plain text, not rendered Markdown/HTML), plus `{tokens}` via `tokenize` of the parsed text. Reads `DBState.db.globalChatVariables` to re-run when variables change. A "Toggles" button opens a 24 rem side panel with the real chat `Toggles` component. Preview and Edit are mutually exclusive (no split view). | `PopupEditor.svelte:17-39,91-116` |
| Close | X and backdrop click both set `open=false`; no Escape handler, no focus trap, no dialog role/aria found in the file. Commit is unconditional. | `:52,:84` |
| Mobile | No mobile-specific code. Monaco is not excluded on phones (no `isMobile` check in these files). Monaco's own mobile story (touch selection, IME, soft keyboard) is not addressed in app code. Unverified on device. | grep |

## 4. Token counting

| Aspect | Observation | Anchor |
|---|---|---|
| Entry | `tokenizeAccurate(data)` = `risuChatParser(data without {{slot}}, {tokenizeAccurate:true})` then `encode()` and `.length`. `tokenize(data)` skips the CBS parse (popup preview calls this on already-parsed text). | `ts/tokenizer.ts:415-427` |
| Which tokenizer | `encode()` picks by the active model: `openrouter`/`reverse_proxy` use `db.customTokenizer` (mistral, llama, novelai, claude, novellist, llama3, gemma, cohere, deepseek, deepseek-v4, glm4, glm5, default o200k_base via `tikJS`); `custom` plugin provider may supply its own tokenizer function; other models branch further down (not read past :170). So the count shown depends on the selected main model, not the field. Optional cache `db.useTokenizerCaching`. | `tokenizer.ts:82-169` |
| Cadence in character editor | A `$effect.pre` watches desc, first message and chat note; `loadTokenize` skips unchanged strings (`lasttokens`), and awaits sequentially. No debounce: runs after every committed change of the bound value, which with `optimaizedInput` means about every 11th keystroke and on blur. | `CharConfig.svelte:60-97` |
| Cadence in lorebook | `{#await getTokens(value.content)}` in the template: re-evaluated whenever `content` changes; no `lasttokens`-style guard, no debounce. Because `getTokens` also writes `tokens` state, it shows the previous count while pending. | `LoreBookData.svelte:46-50,269-273` |
| Tokenizer weight | Tokenizers are loaded lazily by type (`tokenizeWebTokenizers`, wasm/`@mlc-ai/web-tokenizers` per `vite.config.ts:55`); load time and memory not measured. First count after a model change may stall (unverified). | |
| Count meaning | Counts include macro expansion (random/time macros give changing counts; `consistantChar` option exists). The count excludes wrappers like `innerFormat`. The designer should not imply the count equals prompt cost per turn. | `tokenizer.ts:420-427` |

## 5. CBS: macro list, validation, parser

| Aspect | Observation | Anchor |
|---|---|---|
| Macro registry (runtime) | `registerCBS(arg)` in `ts/cbs.ts` (2590 lines) registers each macro through a `registerFunction({name, ...})` callback; block macros have names beginning with `#`; `internalOnly` entries exist. This is the real list. | `cbs.ts:217-244`; `cbsMonaco.ts:7-18` |
| Macro list (editor side, hand-copied) | `highlight.ts` keeps its own arrays: `normalCBS` (~60 no-arg), `normalCBSwithParams` (~90, written as `name::`), `displayRelatedCBS` (raw, img, video, audio, bg, emotion, asset, video-img, comment, image), `nestedCBS` (`#if`, `#if_pure`, `#pure`, `#each`, `#func`, `#pure_display`), `specialCBS`, `deprecatedCBS`, decorators (24 names at :169-173). `AllCBS` (autocomplete source) is a concatenation. Drift risk: two lists (runtime registry vs `highlight.ts`) maintained by hand. | `highlight.ts:127-181` |
| Autocomplete data | Names only, no argument signature, no description. Insert shapes: `{{name}}`, `{{name:`, `{{#if `. Note the stored form of params is `name:` (single colon) while syntax uses `::`; the insert for an entry ending with `:` yields `{{name::` (it prepends `{{` and appends `:`). | `TextAreaInput.svelte:244-255` |
| Unbalanced `{{ }}` / `{{#if}}` validation | None found. The highlighter's brace walker silently tolerates imbalance (`depth--` can go negative; fixed 100-slot Uint8Arrays; no error output). `risuChatParser` uses a nested-string stack (`nested`, `stackType` 512 slots); no diagnostics API seen in the first 70 lines read. A grep of `parser.svelte.ts` for "unbalanced/unclosed/missing }}" returned nothing. Not fully read: other places might surface problems (unverified). | `highlight.ts:297-318`; `parser.svelte.ts:1654-1664` |
| Preview entry | `risuChatParser(text, {chatID?, db?, chara?, var?, ...})` at `parser.svelte.ts:1602`. Defaults to `DBState.db` and selected character; side effects such as `setvar` on the live chat variables are possible unless `runVar`/`rmVar` options are set (semantics not traced, so a sandboxed preview in a mockup must be simulated). Studio slice 1 already simulates its own Test panel in `docs/design/mockups/studio.html`. | `parser.svelte.ts:1602-1664` |
| Comment macro | `{{// ...}}` is highlighted as `comment` (:269). | `highlight.ts:269-271` |
| Deprecated | `<char>`, `<user>`, `<bot>`, `@@end/assistant/user/system` are marked `deprecated`. | `highlight.ts:161-186` |

## 6. Find/replace, undo, spellcheck, wrap, fonts, RTL, very long text

| Topic | Today (obs) |
|---|---|
| Find/replace | Fields: none. Popup Monaco: Monaco's built-in Ctrl+F / Ctrl+H widget (default Monaco behaviour, not touched by app options; unverified at runtime). No cross-field find in the character. |
| Undo | Field: native textarea undo per field, lost on unmount. Popup: Monaco undo, lost on close (store value only). No history between opens. |
| Spellcheck | No explicit attribute set; browser/WebView default. |
| Wrap | Field: wraps. Popup: `wordWrap:'on'`, not user-controllable. |
| Font | Field: proportional UI font, `text-xs` default, global size step 0-3. Popup: mono stack fixed 14 px; does not follow `textAreaTextSize`. Chat edit box follows `zoomsize`/`lineHeight`. |
| RTL / bidi | No `dir` handling in `TextAreaInput`, popup or Monaco options read. |
| Very long text | No max length, no virtualisation, no warning. Textarea branch: native. Dormant highlight branch: whole-text walk on every change (see section 2). Popup preview: `risuChatParser` re-runs on every store change with no debounce (`$derived`). Monaco handles large documents natively. |
| Per-field state | Field boxes carry no dirty/revert/draft state (today-authoring section 2). |

## 7. Floor-device risks (Note 9 / Android 10 WebView; Raspberry Pi 3). Source-reasoned only; nothing measured

| Risk | Basis | Severity guess |
|---|---|---|
| Monaco weight | Full `monaco-editor` plus 4 language workers loaded on first popup open; workers and a large JS chunk on a Pi 3 (1 GB RAM, 4 x Cortex-A53) or an old WebView could stall for seconds or fail on memory. Lazy import mitigates start-up but not the first open. Real sizes unknown (Q3). | High for popup on Pi 3 |
| CSS Custom Highlight API | `CSS.highlights` is guarded (`if(!CSS.highlights) return`), so old WebViews degrade to uncoloured text. Android 10 WebView is updatable but may be older than Chromium 105; Note 9 version unknown. Build target is `baseline-widely-available` (`vite.config.ts:39`), which does not guarantee this API. | Medium (dormant today) |
| contenteditable highlight | Rebuilding every field's ranges on each change, plus whole-text `textContent` rewriting on Enter; heavy on long text and many fields (CharConfig has about 15 `highlight` boxes; TriggerV2 up to about 12). It is off by default (H1) but would be a regression risk if revived. | High if enabled |
| Soft keyboard / IME | `contenteditable` plus Enter interception conflicts with IME candidate confirmation; `bind:value` fires mid-composition in the plain branch. No code comments about these were found (grep for composition/IME/visualViewport in `lib/UI` found none). Known generic Android WebView behaviours (viewport resize on keyboard, caret hidden under keyboard) are not handled in app code here. | Medium-high on phones; unverified |
| Fixed 160 px box on phone | With keyboard open, a 160 px box inside a scrolling sidebar is about 1/6 of the visible area; scrolling inside the box and the page both exist. | Observed from sizes only |
| Autocomplete disabled on mobile | `isMobile` early return; so a mobile CBS helper would be net-new, not a regression. | Info |
| Token count latency | `tokenizeAccurate` runs the full CBS parser plus a WASM/JS tokenizer; on a Pi 3 an unthrottled count on every ~11th keystroke of a long field could cause input lag (unmeasured). | Medium |
| Min SDK | Android `minSdk 24`, `targetSdk 36` (`src-tauri/gen/android/app/build.gradle.kts`, grep only). Note 9 on Android 10 is above min. | Info |

## 8. Proposals (short; not decisions)

1. Replace the 160 px box with a field editor that auto-grows between a min (about 6 lines) and a viewport-relative max, then scrolls; keep `resize` as a handle on desktop. Source basis: H4, `TextAreaResizable.svelte:24-35` already does the grow math.
2. Make the "expand" path visible: an Expand button on every long-text field that opens a focused full-screen editor (header with owner/field name, token count, Done and Cancel), replacing the hidden hotkey/long-press popup. Basis: H5 and section 3.
3. Offer two editing tiers: lightweight textarea (default, all devices) and an optional "rich" tier loaded on demand for CBS highlighting; do not make Monaco the default on the floor devices. Basis: section 7.
4. Give CBS a single data source (runtime registry, as `cbsMonaco.ts:3-21` began) for highlight, autocomplete and a macro reference with arguments and one-line descriptions. Basis: section 5 drift.
5. Add a CBS check line under the field (unbalanced `{{`/`}}`, unclosed `{{#if}}`, deprecated names) computed on idle with debounce; severity limited to warnings. Basis: no validation exists.
6. Show token count on every prompt-bound field, debounced about 300-500 ms and computed on idle, labelled "approx., depends on selected model". Basis: H6, section 4.
7. Structure example messages as a list of conversations (`<START>`) and alternate greetings as a reorderable list of cards with per-card expand, not table cells. Basis: sections 1a, `en.ts:525-529`.
8. Keep Preview as a side-by-side or toggle, with rendered Markdown (today's `<pre>` shows source text). Basis: section 3. Whether Preview may execute `setvar` side effects is a product question (Q7).

## 9. Not read / unverified

- No runtime, device or screenshot evidence; no Monaco or bundle size measurement; no `vite build` run.
- `::highlight(...)` CSS rules; `tokenizer.ts` branches after line 170 and `tokenizeWebTokenizers` loading; `registerCBS` macro bodies and any parse-error reporting in `parser.svelte.ts` beyond lines 1595-1664.
- `MultiLangInput` (creator notes), `LoreBookList`, Persona list editing, module description field, `longtouch` helper, Monaco default find/replace behaviour, Monaco on Android WebView.
- `docs/design/studio/editor.js` and `mockups/studio.html` were not re-read; slice 1 port details assumed from the task brief.
- Typical text sizes per field: no data in source.

## 10. Open product questions for the designer's brief

1. Typical and worst-case sizes: tokens or characters for description, first message, example messages, alternate greetings, lorebook entries (affects whether per-field cards, a document view or both are needed).
2. Should highlighting be restored in plain fields (the dormant feature), or is the plan a separate rich tier? If restored, is CSS Custom Highlight availability on the Note 9 WebView acceptable to lose silently?
3. Is Monaco acceptable on the Pi 3 and Note 9 for any field type, or must the floor use textarea-only editing (with the lite checker in proposal 5)?
4. Does Studio own these fields (full character form inside Studio, per DD-090/091) or are they Library fields with "Edit in Studio" hand-off (completion-plan 02)? Determines whether the long-text editor is a component used by both.
5. Is Cancel/revert desired on the expanded editor (today it always commits) and is a per-field draft/recovery wanted (see ST-03)?
6. Which tokenizer should the count follow: active chat model (today), a Studio-chosen model, or a fixed approximation?
7. Should Preview run `risuChatParser` against live chat variables (today) or a sandboxed synthetic state?
8. Default text size: keep `textAreaTextSize` default 12 px and global step ladder, or raise the default for authoring surfaces?
9. Are RTL, IME-heavy languages (Korean, Japanese, Chinese) and the Korean primary audience a required acceptance case for the editor?
10. Example messages and alternate greetings: should the structured list (proposal 7) replace the raw text stored today, with import/export still storing the raw `<START>` text?
