# Today's Settings and models: source-read discovery

Date: 2026-10-26. Static source read only (no build, no run, no screenshots). Paths are relative to the repo root. Labels: OBSERVED = read in the cited source; INFERRED = my reading of what the source implies at runtime, not run. No design proposals except the "Pain points evidence" list. Builds on `docs/design/completion-plan/evidence/settings-sources.md` (called "the October inventory" below); where it is wrong or thin, see "Corrections".

Page anchors for Plugin, Module, Storage, Persona, Realm and Custom GUI pages are reused from the October inventory and were not re-verified, except where noted.

## 1. Settings shell

OBSERVED, `src/lib/Setting/Settings.svelte`:

| # | Menu entry (label key) | Index set | Shown when | Anchor |
|---|---|---|---|---|
| 1 | Chat bot (`chatBot`) | 1 (also highlighted for 13) | not Lite | 36-45 |
| 2 | Persona | 12 | not Lite | 46-54 |
| 3 | Other bots (`otherBots`) | 2 | not Lite | 55-63 |
| 4 | Display | 3 | not Lite | 64-72 |
| 5 | Language | 10 | always | 74-82 |
| 6 | Accessibility | 11 | not Lite | 84-92 |
| 7 | Modules | 14 | not Lite | 93-101 |
| 8 | Plugin | 4 | not Lite | 102-110 |
| 9 | Backup and files (`backupAndFiles`) | 0 | always | 112-120 |
| 10 | Hotkey | 15 | always (content only if width >= 768, line 208) | 121-129 |
| 11 | Advanced settings | 6 | not Lite | 131-139 |
| 12 | Plugin-defined entries (`additionalSettingsMenu`) | none; calls `menu.callback()` | not Lite | 140-148 |
| 13 | Easy panel | none; sets `easyPanelStore.open` | not Lite and `db.enableRisuaiProTools` | 150-169 |
| 14 | Legal links footer | n/a | always | 171 |

- Index 13 (Prompt template page) has no menu entry. It is reached by the "Prompt template" button in BotSettings (`BotSettings.svelte:872-876`, `Settings.svelte:185-187,204-207`) and returns with a back arrow (`PromptSettings.svelte:133-139`). Indices 5, 7, 8, 9 are unused. Index 16 is tested for highlighting (`Settings.svelte:152`) but never assigned, so the Easy panel entry never looks selected.
- Lite is a build-time flag: `isLite = writable(import.meta.env.VITE_RISU_LITE === 'TRUE')` (`src/ts/lite.ts:6`). It is not a user setting.
- Default page: if width >= 900 and index is -1 and not MobileGUI, index becomes 1 (BotSettings) (`Settings.svelte:22-24`). `SettingsMenuIndex` is `writable(-1)` (`src/ts/stores.svelte.ts:48`).
- Layout: menu column shows if width >= 700 and not MobileGUI, or index === -1 (29). Page column shows if width >= 700 and not MobileGUI, or index !== -1 (179). So below 700 px (or in MobileGUI) it is index-to-detail drill-in.
- Leaving: desktop close button (top-right circle X) sets `settingsOpen=false` when width >= 700, else sets index -1 (back to the menu) (213-224). On the narrow menu the X closes settings (172-176). In MobileGUI neither X renders; leaving is handled outside this component (INFERRED; not traced). Ctrl+S toggles `settingsOpen` (`src/ts/hotkey.ts:180-183`); Escape closes it (`hotkey.ts:379`).
- Page content is wrapped in `{#key $SettingsMenuIndex}` (180), so each page remounts on switch and loses local state such as its sub-tab.
- No search, no breadcrumb, no "recently changed", no modified-from-default marker anywhere in the shell (OBSERVED by absence in `Settings.svelte`).
- Plugin entries: `additionalSettingsMenu` is a `$state([])` of `MenuDef` (`stores.svelte.ts:148`), filled by the V3 plugin API (`src/ts/plugins/apiV3/v3.svelte.ts:1175-1187`). They render below Advanced with a `PluginDefinedIcon` and run an arbitrary callback; they never become the selected index, so they cannot be highlighted or hold a page inside the shell.

### 1b. Is there a data-driven settings schema? Yes, partial.

OBSERVED. Schema `src/ts/setting/types.ts`:
- `SettingItem` (105-187): `id` (unique), `type` (12 kinds: check, text, number, textarea, slider, select, segmented, color, header, button, accordion, custom; 24-36), `labelKey` + `fallbackLabel`, `helpKey` (+ `helpUnrecommended`, `showExperimental` markers), `bindKey` (a `keyof Database`) or `bindPath` ('ooba.top_p') or `getValue/setValue`, `condition(ctx)` for visibility, `options` (min/max/step/fixed/disableable/multiple, `actualMax` + warning, select and segment options with their own `condition`, placeholder, hideText, accordion `children`), `onChange`, `classes/containerClasses`, `componentId/componentProps` for `type:'custom'`, and `keywords?: string[]` ("Search keywords for future search feature", 150).
- `SettingContext` = `{db, modelInfo, subModelInfo}` (15-19). Conditions can therefore depend on the selected model's `parameters`/`flags` (see section 4).
- Renderer: `SettingRenderer.svelte` loops items, runs `checkCondition`, looks up the wrapper in `settingRegistry` (`src/ts/setting/settingRegistry.ts:18-31`; wrappers in `src/lib/Setting/Wrappers/`). Unknown type prints a red error (`SettingRenderer.svelte:37-39`). Custom components registry: 12 entries (`src/ts/setting/customComponents.ts:35-49`), incl. SeparateParametersSection, TranslatorPresetSettings, CustomModelsSettings, SettingsExportButtons, theme editors.
- `SettingCategory` type exists (192-197) but nothing uses it (no category field on items); I found no use of it in the data files read.
- Data files and `id:` counts (grep `id: '`): accessibility 28, advanced 62, display 53, language 21, bot parameters 19, chat format 2 = about 185 items.
- Pages using the schema: Advanced (`AdvancedSettings.svelte:2-6`, whole page), Accessibility, Language (5-line wrapper pages), Display (3 sub-tabs over `displayTheme/Size/OtherSettingsItems`, `DisplaySettings.svelte:5-9,48-58`), Chat format (`ChatFormatSettings.svelte:6`), and the Parameters tab of BotSettings (`BotSettings.svelte:504`, `allBasicParameterItems`).
- Pages NOT in the schema (hand-written Svelte with `language.*` spans): BotSettings Model/Prompt/Others tabs and all provider fields, OtherBotSettings (1186 lines), PersonaSettings, PluginSettings, ModuleSettings, UserSettings (Backup and files), HotkeySettings, PromptSettings, OobaSettings, OpenrouterSettings, StorageMaintenance, CustomGUISettingMenu. About 60% of the settings surface by page, including all model/provider/key/preset setup, has no schema record. (INFERRED proportion; by page list and line counts.)
- Search function exists but has one consumer: `getFullSettingsData(searchTerm)` (`src/ts/setting/utils.ts:81-104`) concatenates accessibility, advanced, basic/seed/sampling/penalty/model-specific params, chat format and display items and filters by translated label, `fallbackLabel` and `keywords`. Consumers: custom sidebar config search (`src/lib/Others/CustomSidebarConfig.svelte:157`) and custom sidebar render (`src/lib/SideBars/CustomSidebar.svelte:83-86`), plus a test that confirms Korean label search (`SettingWrappers.i18n.svelte.test.ts:213-219`). It omits `languageSettingsItems` (utils.ts:82-91 list has no language data), and `keywords` is filled only on some items (e.g. most `params.*` and a few display/advanced ones have them; the 62 advanced items mostly do not).
- Consequence for search (INFERRED): a global settings search can reuse ~185 schema items now (label key, keywords, condition), but a result needs a page/tab locator the schema lacks (no `page`, `tab` or `group` field, and the sub-tab is local `$state` in each page), and the hand-written 40% would need new records.

## 2. Pages

Line counts from `Get-ChildItem` of `src/lib/Setting`. "Tabs" = local sub-tab row, which is `-1` (all sections stacked) when `db.useLegacyGUI` is on (`BotSettings.svelte:117`, `DisplaySettings.svelte:11`, `OtherBotSettings.svelte:31`).

| Page (index) | File, lines | What it holds | Structure and long-scroll notes |
|---|---|---|---|
| Chat bot (1) | `Pages/BotSettings.svelte` 818 | Model + sub model pickers, provider key/URL/format fields, streaming, aux-model block, parameters, prompt, bias, additional params, prompt template, custom flags, module integration, tools, preset regex, preset icon | 4 tabs: Model / Parameters / Prompt / Others (143-166). Others tab is 8 stacked accordions (638-808). Provider fields are 25+ `{#if}` blocks (178-497). A "Presets" button at the bottom opens the preset overlay (845-847, 877-879). |
| Prompt template (13) | `Pages/PromptSettings.svelte` 326 | Ordered list of prompt blocks (drag, up/down, remove, add), token counts, warnings; second tab "Settings" with 20+ controls (system role replacement, JSON schema, group templates, fallback models, aux models) | Tabs Template / Settings (141-152). Settings tab is a long flat form (263-357). Also mounted inline inside BotSettings (`mode='inline'`, 733-743, 866-868). |
| Other bots (2) | `Pages/OtherBotSettings.svelte` 1186 | Long-term memory (types none/supa/hanurai/hypaV2/hypaV3 + HypaV3 presets), TTS keys, emotion method, image generation (WebUI, NovelAI, ComfyUI, OpenAI-style, WaveSpeed etc.) | 4 tabs Memory / TTS / Emotion / Image (238-261); stacked in legacy mode. Largest page; image generation block alone spans ~lines 263-975. Contains `openAIKey` input again under TTS (986), same db field as the chat OpenAI key. |
| Display (3) | `Pages/DisplaySettings.svelte` 52 + `displaySettingsData.svelte.ts` | 53 schema items: GUI/custom HTML, colors, text theme, fonts, zoom, line height, icon/textarea/sidebar sizes, animation speed, quotes styling, notification, background, custom CSS | 3 tabs Theme / Size and speed / Others (16-46). Others tab holds 20+ unrelated toggles (hide API key, legacy GUI, mobile GUI beta, quote styling, custom CSS) (`displaySettingsData.svelte.ts:251-374`). |
| Language (10) | `Pages/LanguageSettings.svelte` 5 + `languageSettingsData.svelte.ts` | UI language, translator language/type, DeepL/DeepLX keys, translator LLM presets, auto-translate, translation cache export/import/clear | Single schema list, 21 items. |
| Accessibility (11) | `Pages/AccessibilitySettings.svelte` 5 + `accessibilitySettingsData.ts` | 28 items: swipe, send with Enter, click to edit, scroll behavior, new-message button, Pro tools toggle, custom sidebar configure | Despite the name, mostly editing/behavior toggles; no contrast/motion items found (`accessibilitySettingsData.ts:12-220` ids). |
| Modules (14) | `Pages/Module/ModuleSettings.svelte` 199, `ModuleMenu.svelte` 342, `ModuleChatMenu.svelte` 121 | Module library, search, global enable, export, create/import, MCP import, editor | Reused from October inventory. |
| Plugin (4) | `Pages/PluginSettings.svelte` 310 | Installed plugins, enable, update, export, settings file, remove | Reused from October inventory. |
| Backup and files (0) | `Pages/UserSettings.svelte` 73 + `StorageMaintenanceSettings.svelte` 17 | 6 buttons: save full backup, save partial, load local, load internal, clean cold storage, export as dataset; storage integrity | Flat stack of full-width buttons (`UserSettings.svelte:15-68`). Not under "Advanced", but named "user" in code. |
| Hotkey (15) | `Pages/HotkeySettings.svelte` 68 | Table of `db.hotkeys`: action name, Ctrl/Shift/Alt toggles, key capture input | Below 768 px the page shows only the red "screen too small" text (8-11). No reset to defaults, no conflict detection (OBSERVED by absence). Quick preset keys Ctrl+1..9 are not in the table (see section 5). |
| Persona (12) | `Pages/PersonaSettings.svelte` 173, `listedPersona.svelte` | Icon grid of personas + add (scratch/import), edit name/note/description, export/import/remove, large portrait | Persona list is an icon-only grid with no names (72-89). Edit form is below. |
| Advanced (6) | `Pages/AdvancedSettings.svelte` 5 + `advancedSettingsData.ts` | 62 items in one flat list: lorebook depth, prompts, retries, vision quality, heights, chat loading, ~35 toggles, experimental/unrecommended items revealed by `useExperimental` / `showUnrecommended`, ban character set, custom models, settings export | Header + warning then one uninterrupted scroll (`advancedSettingsData.ts:7-246`). Section comments in the data (LoreBook, Request, Toggles...) are not rendered as headers. Includes model-related items: custom models, `dynamicModelRegistry`, `auxModelUnderModelSettings`, `presetChain`, `disableSeperateParameterChangeOnPresetChange`. |
| Easy panel (overlay) | `Others/ProTools/EasyPanel.svelte` | Separate-model requirements, models, parameters, custom models | Reused from October inventory (`Settings.svelte:150-168`, `EasyPanel.svelte:21-75`). |
| Custom sidebar config / Custom GUI builder | `Others/CustomSidebarConfig.svelte`, `Pages/CustomGUISettingMenu.svelte` 255 | Sidebar items (model, preset, loadout, persona, any schema setting) / GUI tree builder | Reached from Accessibility and Display. |

Sub-components: `Pages/Model/ModelDataRefresh.svelte` 41 (model catalog refresh), `AuxModelSelectors.svelte` 23, `ClaudeThinkingSeparateParams.svelte` 75, `SeparateParametersSection.svelte` 23, `OobaSettings.svelte` 158, `OpenrouterSettings.svelte` 97, `ChatFormatSettings.svelte` 5, `Advanced/CustomModelsSettings.svelte` 194.

## 3. Model and provider

### How a model is chosen
- OBSERVED: `ModelList.svelte` is a button showing the current model's `fullName` (+ status tag) (152-158). Click opens a fixed modal, 384 px wide (`w-96`), listing providers as accordions of models, `@as-is` models inline, a Horde accordion fetched live, a Custom models accordion, optional "None" for blankable pickers, and a "show unrecommended" checkbox (77-148). No search box, no capability display, no per-model description. By default only `recommended` models are listed (`getModelList({recommendedOnly: !showUnrec, groupedByProvider: true})`, 52-56).
- Gray (dataset or provider-sourced, unconfirmed) models ask a confirm before selection (33-47). Status tags (deprecated etc.) and warnings come from `modelStatus*` (57-60,159-164).
- Model data: `LLMModel {id, name, shortName, fullName, provider, flags[], format, parameters[], tokenizer, recommended, keyIdentifier, endpoint}` (`src/ts/model/types.ts:118-132`). Flags are 28 numeric capability bits (3-32); formats 24 (56-81); providers 17 (35-53).
- `getModelInfo(id)` (`src/ts/model/modellist.ts:828`) resolves catalog entries (+ user custom flags via `withUserFlags`), `hf:::` and `horde:::` prefixes, and others; unknown/empty id gives an "Unknown" OpenAI-compatible model with OpenAI parameters (832-843). `getModelList` merges catalog + added (dynamic) models and a Plugins group (931-971).
- Where `ModelList` is used (grep `import ModelList`): BotSettings (model, sub model), AuxModelSelectors, PromptSettings (fallback lists), EasyPanel, CustomSidebar. There is no model switcher in the chat screen itself other than the optional custom sidebar item (`CustomSidebar.svelte:35-36`). The default hotkey `modelSelect` (Ctrl+M) is declared (`src/ts/defaulthotkeys.ts:74-77`) but I found no handler for it in `hotkey.ts` (grep `modelSelect` no matches). INFERRED: dead hotkey.

### Provider-conditional fields in BotSettings (Model tab)
OBSERVED, all in `BotSettings.svelte` 168-500. Visibility is by selected main or sub model (so keys for both show together):

| Provider / model | Fields | Anchor | db fields |
|---|---|---|---|
| Google Cloud | API key | 178-181 | `google.accessToken` |
| Vertex AI | project id, client email, private key, region (global/us-central1/us-west1) | 182-204 | `google.projectId`, `vertexClientEmail`, `vertexPrivateKey`, `vertexRegion` |
| NovelList / Mancer / Claude+AWS / Mistral / Cohere / OpenAI | one key each | 205-221,257-260,417-420 | `novellistAPI`, `mancerHeader`, `claudeAPIKey`, `mistralKey`, `cohereAPIKey`, `openAIKey` |
| NovelAI | bearer token (not hidden by `hideApiKey`), adventure + append name toggles | 222-225,444-448 | `novelai.token` |
| Reverse proxy (`aiModel`/`subModel === 'reverse_proxy'`) | URL, proxy key, request model name, request format select (OpenAI compatible, Response API, Anthropic, Mistral, Google Cloud, Cohere), Ooba mode toggle, tokenizer select | 226-256,409-416,441-443 | `forceReplaceUrl`, `proxyKey`, `customProxyRequestModel`, `customAPIFormat`, `customTokenizer` |
| Ollama local / cloud | local URL, cloud model (list or manual), API key, request format, thinking mode, streaming | 261-352 | `ollamaURL`, `ollamaApiKey`, `ollamaCloudModel`, `ollamaRequestFormat`, ... |
| NanoGPT | key, dashboard (balance etc.), subscription toggle, model list/manual, provider picker | 353-397 | `nanogptKey`, `nanogptRequestModel`, `nanogptProvider`, ... |
| OpenRouter | key, model grid with pinned Free Auto/OpenRouter Auto, tokenizer; provider routing in Parameters tab | 398-416,629-631 | `openrouterKey`, `openrouterRequestModel`, preset `openrouterProvider` |
| models with `keyIdentifier` | generic key under `OaiCompAPIKeys[keyIdentifier]` for main and sub | 422-430 | `OaiCompAPIKeys` |
| Kobold / Horde / echo / custom plugin / Ooba / textgen webui / Mancer | URL(s), keys, notices | 451-492 | `koboldURL`, `hordeConfig.apiKey`, `textgenWebUI*URL`, `currentPluginProvider` |

- A note above all key fields explains `${NAME}` environment references (`BotSettings.svelte:176`, text at `src/lang/en.ts:347`). Key inputs are masked by `db.hideApiKey`, a toggle that lives on the Display page (`displaySettingsData.svelte.ts` id `display.hideApiKey`, line 299).
- The sections are not labelled "Connection". A user sees: model button, sub-model button, refresh button, an env-var paragraph, then whichever field blocks apply, in source order, with no grouping for "which provider this block belongs to" besides label text (e.g. "Claude API Key").
- OpenRouter specifics: `OpenrouterSettings.svelte` (97 lines, in Parameters tab only when `aiModel.startsWith('openrouter')`, 629-631). October inventory notes provider order/Only/Ignore/fallback/Middle-out/instruct format (October inventory lines 112).
- Ooba: two paths. Reverse proxy with `reverseProxyOobaMode` (and `aiModel==='ooba'`) shows `OobaSettings` in Parameters tab (625-627): mode instruct/chat/chat-instruct and prefix fields (`OobaSettings.svelte:21-50`). Legacy `textgen_webui`/`mancer`/`local_*` shows a hard-coded slider block with 8 sliders and 4 checks bound to `db.ooba` (505-570).
- NovelAI, NovelList have their own hard-coded sampler slider blocks (572-620).
- NanoGPT: three effects silently clear model/provider/subscription state when the key is cleared or the endpoint toggled (`BotSettings.svelte:54-84`).
- Model catalog refresh: `ModelDataRefresh` mounted right under the sub model (174). `db.dynamicModelRegistry` toggles dynamic models (Advanced, `advancedSettingsData.ts:166`). Custom models are edited in Advanced (`CustomModelsSettings`, `advancedSettingsData.ts:244`) and listed in the picker.

### Sub model and auxiliary models
- "Sub model" is a second `ModelList` bound to `db.subModel` (`BotSettings.svelte:172-173`). Help text: used for emotion images and auto suggest, "gpt3.5 recommended" (`src/lang/ko.ts:475`; en equivalent not re-read).
- Per-function models (memory, translation, emotion, other): `AuxModelSelectors` with a master checkbox `seperateModelsForAxModels` and a lock `doNotChangeSeperateModels` (`Model/AuxModelSelectors.svelte:9-29`). Placement is switchable: in the Model tab if `db.auxModelUnderModelSettings` (`BotSettings.svelte:497-499`), otherwise in the Prompt page Settings tab (`PromptSettings.svelte:312-314`). The toggle itself lives in Advanced (`advancedSettingsData.ts:213`).
- Fallback models: five lists (model, memory, translate, emotion, otherAx) in Prompt page Settings tab, plus `fallbackWhenBlankResponse` and a lock `doNotChangeFallbackModels` (`PromptSettings.svelte:316-356`). Used by `requestChatData`: attempt 0 is the selected model then the fallback list; each model retries up to `db.requestRetrys`, blank responses can skip to the next (`src/ts/process/request/request.ts:203-371`).
- Separate parameters: `SeparateParametersSection` (Parameters tab, `BotSettings.svelte:634`): checkbox `seperateParametersEnabled` then four accordions (longTermMemory, emotionImage, translator, others), each `AllSeperateParameters` (`SeparateParametersSection.svelte:8-25`). `ClaudeThinkingSeparateParams.svelte` (75 lines) is the Claude thinking portion for those; I did not read it in depth.
- Where model/params for aux features are per-preset: `seperateModels`, `fallbackModels`, `seperateParameters` are stored on the preset, but the two lock flags (`doNotChangeSeperateModels`, `doNotChangeFallbackModels`, `disableSeperateParameterChangeOnPresetChange`) make preset switches skip them (`database.svelte.ts:2303-2333`). OBSERVED: a preset switch can leave aux models/fallbacks/separate params unchanged depending on three hidden flags.

### Where API keys live
- OBSERVED: global `DBState.db` fields, not on the preset in the UI sense, though some are copied into presets: `botPreset` has `openAIKey?`, `proxyKey`, `forceReplaceUrl`, `textgenWebUI*URL` (`database.svelte.ts:1639,1656,1662,1654-1655`), and `presetFromWorkingSettings` copies `proxyKey`, `forceReplaceUrl`, URLs (2115-2120). Export blanks them: `downloadPreset` empties `openAIKey, forceReplaceUrl, forceReplaceUrl2, proxyKey, textgenWebUIStreamURL, textgenWebUIBlockingURL` (2360-2365). Import does not apply them to the live key fields except via `setPreset`, which loads `proxyKey`, `forceReplaceUrl`, URLs from the preset when present (2239-2243). So the reverse-proxy URL and proxy key travel with each preset, while provider keys (`claudeAPIKey`, `openAIKey`, ...) are global. (OBSERVED fields; the user-visible consequence is INFERRED.)
- A key value may be `${NAME}` and is resolved at request time by `resolveRequestKey` (`src/ts/process/request/secretKey.ts:9-14`; previews keep the reference).
- There is no "connection" object in the data model: no named connection, no per-provider key store UI beyond these fields.

### Missing key or model at send time
- OBSERVED: I found no pre-send validation that a key or model is set. Request code reads keys straight from `db` (e.g. `anthropic.ts:83`, `openAI/requests.ts:554`, `request.ts:518`) and `getModelInfo('')` returns an "Unknown" fallback model (`modellist.ts:831-843`). The only explicit empty-key alerts I found are in onboarding (`WelcomeRisu.svelte:55`, `errors.invalidApiKey`) and a few specific services (`wavespeedKeyMissing`, `googlesearchclient.ts:69`).
- INFERRED (not run): sending with no key fails at the provider (HTTP error) and surfaces through the generic failure path in `requestChatData` (retry up to `requestRetrys`, then `{type:'fail'}` returned, `request.ts:336-362`), so the user sees a provider error string rather than a "set your key in Settings > Chat bot > Model" message. Searched `src/ts/process` and `src/lang/en.ts` error keys only; not exhaustive.

## 4. Parameters

OBSERVED, `src/ts/setting/botSettingsParamsData.ts` (schema items, rendered in the Parameters tab by `SettingRenderer` with the selected model as context, `BotSettings.svelte:504`):

| Control | Type, range | Visible when |
|---|---|---|
| Max context | number, min 0; shows model's listed max and warns above it (`actualMax` from `getModelContextLimit`) | always (lines 17-28) |
| Max response | number 0-2048 | always (29-36) |
| Seed | number | `aiModel` starts with `gpt`, or reverse_proxy, or openrouter (47-51) |
| Temperature | slider 0-200 shown x0.01 (0-2.00), disableable | `modelInfo.parameters` includes `temperature` (64) |
| Frequency / presence penalty | slider 0-200 x0.01, disableable | `frequency_penalty` / `presence_penalty` in parameters (86,101) |
| Top P | slider 0-1 step 0.01, disableable | `top_p` (116) |
| Top K | 0-100 | `top_k` (220) |
| Min P, Top A | 0-1 | `min_p`, `top_a` (234,249) |
| Repetition penalty | 0-2 | `repetition_penalty` (264) |
| Reasoning effort | segmented minimal/none/low/medium/high/xhigh, options by flags | `reasoning_effort*` params (279-294) |
| Verbosity | low/medium/high | `verbosity` (301) |
| Thinking type, tokens, adaptive effort (Claude) | segmented / slider -1..64000 step 200 | `claudeThinking` / `claudeAdaptiveThinking` flags (137-197) |
| DeepSeek thinking mode, reasoning effort | segmented | `deepSeekThinkingToggle` flag (154,204) |

- Unsupported parameters: they are hidden, not disabled, with no explanation (a control simply does not render when `condition` fails, `SettingRenderer.svelte:33`). `LLMParameter` lists per model come from `ctx.modelInfo.parameters` (`types.ts:127`; named sets such as `OpenAIParameters`, `GPT5Parameters`, `ClaudeParameters`, 154-160). A user switching to a model that lacks `top_p` sees the slider vanish; the stored value stays in db (INFERRED: nothing clears it).
- Order of controls is fixed in `allBasicParameterItems` (317-339): max context, max response, seed, thinking, temperature, top K/min P/top A, repetition, reasoning, verbosity, top P, frequency, presence.
- Hard-coded non-schema parameter blocks below the schema list, chosen by model family: Ooba/textgen/local (`BotSettings.svelte:505-570`, 8 sliders, 4 checks, stop strings, chat format), NovelAI (572-604, 14 sliders + starter/separator), NovelList (606-620, 7 sliders). Their ranges are literals in the markup.
- The slider tooltip/help: `helpKey: 'tempature'` (typo in key) on temperature; most others have no help (`botSettingsParamsData.ts:62`).
- Defaults: schema items carry no default or "reset" value and no description; defaults live in `database.svelte.ts` and `presetTemplate`/`prebuiltPresets` (not read in detail). `disableable: true` means a special low value disables the param (`types.ts:71`, "Allow -1000 to disable"; exact UI behavior in `SettingSlider.svelte` not read).
- Other parameter-like fields in the Others tab: `bias` table (638-692), `additionalParams` key/value table (694-730), custom flags (28-ish toggle buttons over `LLMFlags`, 758-789), tools, module integration.
- Storage: all of these are live `db` fields that are copied into the active preset by `presetFromWorkingSettings` (`database.svelte.ts:2100-2175`: temperature, maxContext, maxResponse, penalties, top_p/k/a, min_p, reasonEffort, thinking*, verbosity, bias, ooba, NAI settings, ainconfig, seperateParameters, customFlags, promptTemplate, regex, etc.). Global-only (not in the preset type): `useStreaming`, `streamGeminiThoughts`, `generationSeed`, `customTokenizer`, `ollama*`, `nanogpt*`, `OaiCompAPIKeys`, all provider keys, `additionalParams` and `modelTools` ... partly. OBSERVED: `modelTools` and `additionalParams`; `additionalParams` and `generationSeed` do not appear in `presetFromWorkingSettings` or `setPreset` (not found in either). INFERRED: they are not per-preset, but I did not grep every field.

## 5. Presets

### What "preset" means today (clarification)
- OBSERVED: "Bot preset" (`botPreset`, `database.svelte.ts:1636-1735`) is the saved bundle of the working Chat bot settings: model, sub model, key-adjacent URLs, all parameters, main prompt / jailbreak / global note / formating order, the `promptTemplate` (ordered `PromptItem[]`), `promptSettings`, regex scripts, aux models, fallback models, separate parameters, custom flags, bias, image. It is what the "Presets" button/Ctrl+P overlay lists.
- "Prompt template" (`promptTemplate`, `PromptItem` types plain/typed/chat/author note/chatML/cache, `src/ts/process/prompt.ts:9`) is one field inside a bot preset, used instead of main prompt / jailbreak / global note / format order when set (`BotSettings.svelte:733-743,850-869`). It has no library of its own: no separate list of prompt templates, no import/export except through the whole preset, plus `PromptDiffModal` compare. When the maintainer says "prompt presets" (DS-001), the only list object that exists is the bot preset list; there is no separate "prompt preset" store. (INFERRED reading of the maintainer's term; needs confirming, see open questions.)
- Other things named preset: HypaV3 presets (`db.hypaV3Presets`, `OtherBotSettings.svelte:35`), translator presets (`Language/TranslatorPresetSettings.svelte`), `loadouts` (a saved combination of preset name + persona + modules + global variables, `src/ts/loadout.ts:6-17`, has `favorite` and `lastUsed`; applying switches preset by name `loadout.ts:61-66`), and `presetChain`.

### Working copy model (important for any redesign)
OBSERVED, `database.svelte.ts`:
- The live settings are plain `db` fields. The active preset in `db.botPresets[db.botPresetsId]` is only a snapshot. Edits in Chat bot settings change `db.*` immediately; they are written back into the preset array only by `saveCurrentPreset()` (2178-2198), which runs on `changeToPreset` (2210-2219), `copyPreset` (2201-2208) and `downloadPreset` (2355-2358). No other caller (grep). The persistence layer separately watches `botPresets` and `botPresetsId` (`dbChangeEffects.svelte.ts:46-52`).
- `changeToPreset(id)` saves current, sets the id, and copies the preset's fields into `db` with fallbacks (`setPreset`, 2221-2339) where a field the preset lacks keeps the previous live value (`?? db.x`, e.g. 2222-2243).
- INFERRED: the preset list names/images edited in the overlay are written directly to `botPresets[i]`, but the settings values shown in the list are stale until a switch or copy. There is no "modified since last saved" indicator and no explicit "save preset" or "revert".

### Preset overlay (`src/lib/Setting/botpreset.svelte`, 325 lines)
- Opened by `openPresetList` store (`stores.svelte.ts:42`, mounted `App.svelte:243-244`) from: BotSettings "Presets" button (`BotSettings.svelte:846,878`), custom sidebar `preset` item (`CustomSidebar.svelte:37-44`), hotkey `presets` Ctrl+P (`hotkey.ts:188-191`), and the Ctrl+` quick menu (`hotkey.ts:438-448`). There is no preset switcher in the chat header, hamburger or elsewhere (grep `openPresetList`).
- Layout: a modal `max-w-3xl w-124 max-h-full overflow-y-auto` with a flat list; each row: optional number, icon, name, and four icons (compare if `showPromptComparison`, copy, share/export, delete) (102-272). Footer: add (+), import, edit-names pencil, then one hint line `language.quickPreset` (299-321).
- **The shortcut limit, exact code.** `src/ts/hotkey.ts:309-366`:
  ```
  if(ev.ctrlKey){
      switch (ev.key){
          case "1":{ changeToPreset(0) ... }
          ...
          case "9":{ changeToPreset(8) ... }
  ```
  Nine hard-coded cases, Ctrl+1 to Ctrl+9, mapping to preset indexes 0 to 8; there is no case for "0" (so the limit is the first 9, not 10). The row number badge matches: `{#if i < 9}<span>{i + 1}</span>{/if}` (`botpreset.svelte:194-196`). Hint text: "You can quickly change preset by Ctrl + (Index of Preset)" (`src/lang/en.ts:1288`). The helper `changeToPreset(num)` ignores indexes past the list length and shows a toast (`hotkey.ts:560-569`). These keys are separate from the user-editable hotkey table (`defaulthotkeys.ts` has no digit entries), so they cannot be rebound or disabled in the Hotkey page. Because the index is list position, reordering or deleting changes which preset a digit selects.
- Add: pushes a clone of `prebuiltPresets.OAI2` named "New Preset" at the end, not a copy of the current preset (`botpreset.svelte:300-309`). Copy: clones and appends " Copy" at the end, selection unchanged (`database.svelte.ts:2201-2208`). Rename: pencil toggles `editMode`, rows become text inputs (191-193, 315-319); entering edit mode disables switching and drag. Icon: set in Chat bot > Others > Icon accordion (48x48 JPEG data URL, `BotSettings.svelte:810-844`), not in the overlay.
- Reorder: drag and drop only (HTML5 drag, `RISU_PRESET_DRAG_TYPE`, `movePreset` 28-49, handlers 51-69, 147-190); no keyboard or touch reorder (INFERRED from absence; HTML5 DnD is unreliable on touch).
- Delete: confirm with the name; blocked with an error when only one preset remains (`errors.onlyOneChat`); after deleting, it calls `changeToPreset(0)` then removes then `changeToPreset(0,false)`, so the active preset always becomes the first one (244-263). This is the "last-preset rule" (at least one) plus the "jump to first" side effect. No undo.
- Compare: only if `db.showPromptComparison` (Display > Others); pick two rows, opens `PromptDiffModal` (72-91,325-331).
- Export/import: share icon -> `alertCardExport('preset')` -> local `.risup` (compressed, encrypted msgpack, RPack) or Realm upload (`botpreset.svelte:226-243`, `downloadPreset` 2355-2401). Import accepts json, preset, risupreset, risup, and converts NovelAI v3 and SillyTavern presets (`importPreset` 2404-2514+). Import pushes at the end; there is no import preview or duplicate-name handling that I saw.
- **No folders, tags, sort, search, pinning or favorites for presets** (OBSERVED: no such fields in `botPreset`, `1636-1735`; no such UI in `botpreset.svelte`). The list is one flat, user-ordered array. Characters have folders (`display.showFolderName` etc.) but presets do not. Loadouts have `favorite` (`loadout.ts:12`), presets do not.
- Preset name is the identity for `presetChain` (random switch on each send; comma-separated names in Advanced, `process/index.svelte.ts:597-612`) and for loadouts (`loadout.ts:62`). Names are not enforced unique (INFERRED; no check seen). Renaming silently breaks chain entries and loadouts.
- Per-character or per-chat preset binding: none found (grep `botPresetsId`). Persona has a per-chat binding (`CustomSidebar.svelte:63-80`), preset does not.
- Unnamed presets show `language.unnamedPreset` only as a drag label; a nameless row renders an empty span (`botpreset.svelte:157,201`) (tests exist for unnamed handling, not read).

## 6. Hotkeys, hide/show features, low power

- Hotkeys: `db.hotkeys` (`Hotkey {key, ctrl?, shift?, alt?, action}` `defaulthotkeys.ts:2-8`), 26 defaults (10-146). Editable table (section 2). Default actions include: reroll, unreroll, translate, remove, edit, copy, send, settings (Ctrl+S), home (Ctrl+H), presets (Ctrl+P), persona (Ctrl+E), modelSelect (Ctrl+M; no handler found), toggleCSS (Ctrl+.), prevChar/nextChar, quickMenu (Ctrl+`), quickSettings (Ctrl+Q), toggleVoice, toggleLog, previewRequest, webcam, focusInput (Space), scrollToActiveChar, popupEditor, loadout (Ctrl+O). Persona Ctrl+E and edit Ctrl+Alt+E use the same key letter with different modifiers. Comment "Needs to implement after this" sits above prevChar (`defaulthotkeys.ts:84`); I did not verify handlers for every action after it.
- Settings that hide/show features (all in the schema pages unless noted): Display: hide Realm (`display.hideRealm`), hide all images, show folder name, show memory limit, use legacy GUI (turns every tabbed page into one stacked page, `useLegacyGUI`), beta mobile GUI, menu side bar, hide API key (`displaySettingsData.svelte.ts:253-300,351-353`). Accessibility: enable Pro tools (reveals Easy panel), custom sidebar config, show menu chat list, hamburger button bottom (`accessibilitySettingsData.ts:84-220`). Advanced: show unrecommended and use experimental reveal extra items (`advancedSettingsData.ts:121,123,151,172-183,218-240`); bookmark, dev tools, dynamic assets (`187,201,210`). Also `dynamicModelRegistry`, `auxModelUnderModelSettings` (relocates a block between pages, `advancedSettingsData.ts:213`). These mode-like switches are scattered across four pages.
- Low power / performance: I found no low-power, battery or performance mode in settings (grep of `src/lang/en.ts` for low power, battery, performance hits only a dynamic-assets warning, a persistent-storage message, a WebGPU message and Horde "Performance" labels). Performance-adjacent settings that do exist: animation speed (`display.animationSpeed`), `streamingDisplayOptimizationMode` (experimental, `advancedSettingsData.ts:145-161`), chat page loading counts (`adv.chatLoadInitial/Additional`, 97-104), tokenizer caching (`adv.tokCache`, 212), image compression (122), keep session alive (69-78), anti server overload (204), cold storage archive (168). Lite is a build flag only (`lite.ts:6`).

## 7. i18n

- OBSERVED: `src/lang/` has 7 locale modules (en, ko, cn, zh-Hant, de, es, vi). `changeLanguage` merges the chosen locale over a clone of English, so a missing key falls back to English (`src/lang/index.ts:13-35`). `localeParity.test.ts` asserts every locale has the same keys/arity/placeholders as en (`localeParity.test.ts:59-81`), so each locale is expected to cover all settings strings.
- Korean exists for settings: `chatBot` "채팅 봇", `otherBots` "기타 봇", `presets` "프리셋", `advancedSettings` "고급 설정", `hotkey` "단축키", `promptTemplate` "프롬프트 템플릿", `backupAndFiles` "백업 & 파일", `quickPreset` "Ctrl + (프리셋 번호)로 프리셋을 빠르게 변경할 수 있습니다" (`ko.ts:1198,1199,1144,1028,1758,1348,2204,1159`). Korean labels are searchable in the schema search (test `SettingWrappers.i18n.svelte.test.ts:213-219`).
- Label source: `language.<key>` or `language.settingsPage.<key>` in hand-written pages; `labelKey` strings resolved by `getLabel` with `fallbackLabel` in schema pages (`utils.ts:17-22`). Several schema labels are English-only literals (`fallbackLabel` without `labelKey`, e.g. 'Top K', 'Min P', 'Reasoning Effort', `botSettingsParamsData.ts:114,218,232,277`; select options 'Low/High' have labelKeys). Hand-written provider blocks mix literals ('Top P', 'Repetition Penalty', 'Do Sample', `BotSettings.svelte:506-531`) and keys. Provider names are not translated (they are proper nouns).
- Help text: `language.help.<key>` used by `Help` components; many controls lack a `helpKey`.

## Pain points evidence (DS-001)

1. Hard to find a setting.
   - ~13 menu entries with overlapping names (Chat bot vs Other bots vs Advanced vs Display others vs Accessibility), no search (`Settings.svelte` has none), and each page remounts and forgets its tab (`Settings.svelte:180`).
   - Unrelated toggles are bucketed by file, not by task: hide API key is under Display (`displaySettingsData.svelte.ts:299`), preset chain / aux-model placement / dynamic model registry under Advanced (`advancedSettingsData.ts:39,166,213`), Pro tools under Accessibility (`accessibilitySettingsData.ts:214`), the OpenAI key appears on both Chat bot and Other bots > TTS (`BotSettings.svelte:419`, `OtherBotSettings.svelte:986`).
   - Advanced is a 62-item single scroll; Other bots is 1186 lines; Chat bot Others has 8 accordions.
   - Search plumbing exists for about 185 schema items but has only the sidebar-config consumer (`utils.ts:81`), no page/tab locator, and misses the hand-written pages.
2. Model setup confusing.
   - Provider, key, URL, request model, format and tokenizer controls for every provider are in one scrolling Model tab, shown if either the main or the sub model needs them (`BotSettings.svelte:178-500`), so keys for the sub model appear mixed with the main model's.
   - Reverse-proxy needs URL + key + request model + format + tokenizer + Ooba toggle in different places (226-256, 409-416, 441-443).
   - Model picker modal has no search or capability info and hides non-recommended models behind a checkbox (`ModelList.svelte:52-56,144-146`).
   - Aux/fallback/separate-parameter model placement is split across Model tab, Prompt page Settings tab, Parameters tab and an Advanced toggle (see section 3), plus three lock flags that make preset switches skip them (`database.svelte.ts:2303-2333`).
   - Missing key/model has no guided error (section 3).
   - Reverse proxy URL/key travel with presets but other provider keys do not.
3. Parameters opaque.
   - Unsupported params are silently hidden; no explanation or "why" (`SettingRenderer.svelte:33`).
   - Few help texts, no defaults, no reset, typo'd help key (`botSettingsParamsData.ts:62`); sampler blocks for Ooba/NovelAI/NovelList are raw labels with no help (`BotSettings.svelte:505-620`).
   - Temperature is stored 0-200 and displayed x0.01 (`botSettingsParamsData.ts:66-70`); `disableable` sentinel semantic not shown in the schema.
   - Context size warning exists (`actualMax`), but nothing links a model's capabilities to the parameters shown.
4. Presets hard to manage.
   - The only preset surface is a flat modal list; Ctrl+1..9 are hard-coded for the first nine (`hotkey.ts:309-366`, `botpreset.svelte:194`); not rebindable (absent from `defaulthotkeys.ts`). Maintainer's "first 10" is actually 9 in source.
   - No folders, tags, search, sort, favorites or pins (`database.svelte.ts:1636-1735`, `botpreset.svelte`); reorder by HTML5 drag only; modal list of N rows scrolls with no filter.
   - "Prompt presets" are the same bot presets; prompt template is a single field with no library.
   - Working-copy model with silent save-on-switch (`database.svelte.ts:2178-2219`), no dirty marker; delete jumps to the first preset (`botpreset.svelte:257-261`); Add creates from a built-in template not the current preset (`302-304`); rename by name breaks `presetChain` and loadouts (`index.svelte.ts:597-612`, `loadout.ts:62`).
   - Preset icon is set in a different page (Chat bot > Others) from the list that shows it.

## Corrections to settings-sources.md

1. Line 42: it says index `2` routes to "auxiliary AI". The menu label is "Other bots" (`otherBots`, `Settings.svelte:55-63`) and the page holds long-term memory, TTS, emotion image and image generation (`OtherBotSettings.svelte:238-261`), not general auxiliary model selection; the aux model selectors are in Chat bot (Model tab if `auxModelUnderModelSettings`) or Prompt page Settings tab. The table row at line 29 labels the same page better but still lumps it with "translation settings/presets" and `AuxModelSelectors`, which are not on that page (translation presets are on Language).
2. Line 42 lists indices but omits that index 13 (prompt template) has no menu entry and indices 5, 7, 8, 9, 16 are not pages; it also omits that menu order is Chat bot, Persona, Other bots, Display, Language, Accessibility, Modules, Plugin, Backup, Hotkey, Advanced (`Settings.svelte:36-139`).
3. Line 42: "Lite mode hides several families". Lite is a build-time env flag, not a runtime or user mode (`lite.ts:6`).
4. Line 44 calls settings search "a new design behavior rather than a verified existing global setting search". True that there is no settings-page search, but a schema search already exists (`utils.ts:81-104`, used by sidebar config search `CustomSidebarConfig.svelte:157`) with a `keywords` field explicitly meant for it (`types.ts:150`). Not mentioned in the October inventory. It excludes language items and all hand-written pages.
5. Lines 46: Display/Accessibility/Language data are cited, but the file does not say these pages (plus Advanced, params, chat format) are the whole of the data-driven schema (about 185 items) and that Model/Prompt/Other bots/Persona/Plugin/Module/Backup are not.
6. Line 52: "Reverse proxy additionally chooses URL, key, request model and request format" is right; it omits the separate tokenizer select (`BotSettings.svelte:409-416`) and the Ooba-mode toggle (441-443), and that fields appear for either main or sub model.
7. Line 56: "preset management includes ... reordering" is right but incomplete: reorder is drag-only; Ctrl+1..9 quick switch (`hotkey.ts:309-366`), add-from-template, last-preset deletion behavior and the working-copy save model are absent from the October inventory.
8. Line 42/26: "hotkey content branch gated at 768 px (`Settings.svelte:179-224`)" is correct for the content (`Settings.svelte:208`, also `HotkeySettings.svelte:8`), but the menu entry itself is visible at any width, so narrow users can open a page that only says the screen is too small.
9. Anchor ranges for `BotSettings.svelte:141-176,178-255,261-355` (line 27) are accurate but cover only part of the provider blocks; provider fields run to line 500.

## Open questions for the maintainer

1. Does "prompt presets" mean the bot preset list (as the code has it), or a separate reusable library of prompt templates (which does not exist today)?
2. Quick-switch limit: should a redesigned quick switch support more than nine (for example pinned/favorite presets, a numbered subset, or a searchable switcher), and should the digit shortcuts stay hard-wired or become rebindable hotkeys? (Today it is Ctrl+1..9, positional.)
3. Should presets get organization (folders, tags, favorites, search) and do those need to survive export/import and the `.risup` format? Are preset names meant to be unique identities (chains, loadouts use names)?
4. Should preset edits become explicit (draft, dirty marker, save/revert) instead of the silent save-on-switch working copy? That changes the data-flow assumption the whole page rests on.
5. Which provider keys should stay global versus per-preset or per-connection? Today reverse-proxy URL/key are preset-scoped, other keys global.
6. Is `modelSelect` (Ctrl+M) intended to exist? The default is declared but I found no handler.
7. Is a low-power or performance mode wanted as a new setting (none exists today), and should Lite stay a build flag?
8. Should plugin-defined settings entries become real pages inside the shell (selectable, highlightable), or remain callback launchers?
