# Studio S4 (#682): preset advanced form

Status: **spec, revision 3** (2026-11-23). Revision 3 answers Gate 1 round 1 (S1-S4, E1-E9) with the maintainer's answers MC-4045..4047; changed sections: 3 (header), 3.1, 3.2, 3.3, 3.5, 3.7, 3.9, 4.2, 4.3, 4.5, 5.4, 5.5 (layout), 6.1, 6.4, 6.6, 7, 8 (S4a, S4b, S4c), 9, 10, 11 (facts), 12. Revision 2 applied MC-4030..4041. Ticket yor42/RisuTanium#682. Spec only (MC-3902); the build lands as staged PRs on #682 (MC-3975), and only the last stage closes the ticket. Builds on [SLICE1_SPEC.md](SLICE1_SPEC.md) (owners and kinds; `고급` placeholder), [SLICE3_SPEC.md](SLICE3_SPEC.md) (long-text editor "LT"), [SLICE4_SPEC.md](SLICE4_SPEC.md) (character forms, form frame, copy conventions) and the merged #650 preset owner (MC-3890..3896, `Agents/stages/650/STAGE_HANDOFF.md`). Decisions: MC-3970..3979 and MC-4030..4047 (this ticket), MC-3890..3896 (#650), MC-3900..3902 (#651), MC-1758 (preset history is memory-only), MC-175/MC-223/MC-774 (compatibility), DD-094/DD-095/DD-157 in [DECISIONS.md](../DECISIONS.md).

Scope: the real `고급` form of a **preset** owner. It replaces slice 1's read-only note for `kind=advanced` on a preset (`StudioDetail.svelte`, the `studioReadOnlyNote` branch). Out of scope: the prompt template item list (MC-3971, ticket #707), the preset regex list (#684), the toggle builder (#650, merged), provider-specific blocks (MC-3970; ticket #706, MC-4041) and connection fields (MC-3976), Studio search entries for these fields, the preset save chip (#666, MC-3894), the module `고급` form (#683).

Marked **(design default)** = chosen here inside a decided intent, open to veto. **Feature-complete rule (MC-4030):** whatever classic offers on a field this form covers exists in Studio; a classic link is only an interim step with a filed follow-up (#706, #707). Section 5.5 lists the classic affordances carried over. Evidence is source-read on main `48691dfaa`; `file:line` anchors are dated to that snapshot.

## 0. Today (source-read)

| Fact | Anchor (`src/`) |
|---|---|
| A preset is a `botPreset` slot in `db.botPresets`; the active one's live values are the working settings `db.*`. `setPreset` copies a slot into `db.*` on a switch; `saveCurrentPreset` rebuilds the whole active slot from `db.*` (`presetFromWorkingSettings`), carrying only id/folder/hotkey slot, `name` and `image` from the old slot. `changeToPreset` saves first, then switches. | `ts/storage/database.svelte.ts:2327-2408, :2431-2475, :2477-2594`; `presetMeta.ts:85-96` |
| Classic binds every preset field to `db.*`, so it edits the active preset only. The icon (48x48 JPEG data URL) is written onto the active slot by `setCurrentPresetImage`; the name in the preset list's edit mode, unvalidated. | `Setting/Pages/BotSettings.svelte`, `PromptSettings.svelte`; `BotSettings.svelte:818-852`; `storage/currentPreset.ts:17-24`; `Setting/botpreset.svelte:256-257` |
| Studio's preset owner `preset:<id>` is a session kind (memory-only history, banner `studioBannerPresetSession`); its adapter accepts one path, `customModuleToggle`, routed by id at each read and write (active → `db`, inactive → slot). `editField` needs a character target, so only `editText` reaches a preset; a session write's `false` is reported as gone. | `ts/studio/edit/presetTarget.ts:28-117`; `history/sessionKinds.ts:14-17`; `history/ownerHistory.svelte.ts:906-913, :1218-1239` |
| History values are text or bool only (`FieldValue`, facts, frozen rule F-e). | `history/historyModel.ts:112`; `history/fieldRegistry.ts:37-47`; `history/tests/fieldRegistry.frozen.test.ts:76-81` |
| Dirty tracking: one effect deep-snapshots `db.botPresets`/`botPresetsId`, a generic loop every other top-level `db` key; slot and `db.*` writes are both saved with no Studio mark. | `ts/storage/dbChangeEffects.svelte.ts:125-138, :248-262` |
| `PRESET_FIELD_RULE` makes an unclassified new `botPreset` key a build error; `PRESET_DB_ALIASES` names the slot/db name differences (`reasonEffort`/`reasoningEffort` and two out of scope). | `ts/drive/rtb/settingsFields.ts:226-252` |
| Prompt options (`PromptSettings` sub-menu 1): the Bot settings page mounts them only with a template, the standalone prompt page (Settings index 13, Studio's classic link) always. The main prompt block shows only without a template. Request paths read `jsonSchemaEnabled`, `fallbackModels`, `systemRoleReplacement`, `groupOtherBotRole`, `outputImageModal` with no template check. | `BotSettings.svelte:741-750, :858-877`; `PromptSettings.svelte:133-153, :262-354`; `Setting/Settings.svelte:256-257`; `request/openAI/requests.ts:424`; `request/request.ts:264, :504`; `process/index.svelte.ts:2009-2018, :2821` |
| Parameter visibility is data-driven from the model's `parameters` and `flags`. | `ts/setting/botSettingsParamsData.ts:16-339` |
## 1. Where it lives, and the data rules

- **Owner and kind.** Owner `preset:<id>` (`presetOwnerKey`), kind `advanced`, one item (`ownerModel.ts:445`). Mounted by `StudioDetail` when `owner.type === 'preset'`, `studioScreen.selectedPresetId !== null` and `kind === 'advanced'`, keyed by the pinned id (as the #650 builder: a reorder keeps the form, another preset builds a new one). Not part of `formLive`: no save chip (MC-3894, #666). The read-only note no longer shows for this kind; the "open in the classic editor" button stays (Settings prompt page, `classicLinks.svelte.ts:61`).
- **Every preset, active or not (MC-3972, MC-3890).** Each read and each write resolves the preset by id at that moment: exactly one holder required, else **gone**. Active → the working copy (`db.<dbProp>`), inactive → its slot (`slot.<slotProp>`), except the slot-only fields (name, icon), which always go to the slot. Nothing is cached across calls.
- **Store-backed (DD-157).** The form holds only the preset id. Values are read through the adapter on every render; no component copy of the slot or of `db`.
- **Saving (DD-095 hybrid).** Every control writes live through the history service: text after composition and the LT pause; switches, selects and list operations at once; number inputs and sliders as typing (coalesced by path). Each landed write is one history step of the preset owner. Nothing is a draft except text inside the LT pause window and an IME composition.
- **History is page-session only (MC-1758, MC-3892).** The banner `studioBannerPresetSession` shows at the top of the form whenever the preset's history is open (the service's `session` banner).
- **Gone preset (MC-3896).** When the pinned id has no holder or several (delete, import, `.rtb` restore), `StudioDetail` clears the selection with `studioRefusalPresetGone` (existing effect, `StudioDetail.svelte:126-138`); typing since the last write is dropped, no preset changes. A write refused as gone shows the same text in the form's refusal line.
- **Not in chat.** For an inactive preset a status line sits under the banner: `studioPresetNotInChat` (section 9). It is not shown for the active preset.
- **Classic preset tickets (not decided here).** #150 (CHORE-576, save as you type): if it rebuilds the active slot on each edit, Studio's `db.*` writes stay correct; if it writes classic edits into the slot directly, the routing table (4.1) must follow. #148 (CHORE-574, preset undo, restore points, Recently Deleted): its stored history would sit beside Studio's page-session history over the same fields (MC-1758), and a preset restored with its old id makes a selection cleared as gone (MC-3896) valid again.
- **Connections (MC-3976).** The form neither reads nor writes `proxyConnectionId`, `openAIKey`, `proxyKey`, `forceReplaceUrl*`, `textgenWebUI*URL`, `koboldURL`, `currentPluginProvider`, `localNetwork*`. The Model section ends with the existing `ConnectionsLink` row ("Manage in Connections", `connectionsManageLink`).

## 2. Form frame and layout

The frame is SLICE4 §2's (sections with a header button, `aria-expanded`; labels above controls; LT for long text; role tokens). The character build (`StudioAdvancedForm.svelte`) did not implement SLICE4's folding; this form follows the build, not the mockup: **no field folding**; sections are collapsible, all expanded on first visit, collapse state per owner on this device (design default, DD-099 storage). Part names: form `studio-preset-advanced-form`; section `studio-preset-section` with `data-section`; field parts `studio-preset-<path>` (FIELD_PRESENTATION focus targets).

Order, top to bottom (fields within a section in section 3's row order):

1. **Status lines**: page-session banner; `studioPresetNotInChat` (inactive only); refusal line (`studio-form-refusal`, as the character form).
2. **이름과 아이콘 (Name and icon)**, 3.1.
3. **모델 (Model)**, 3.2, with the MC-3972 note (4.5), then the model data refresh row (classic's `ModelDataRefresh`, `BotSettings.svelte:180`), the Connections row and one line "Provider settings stay in the classic editor" with the classic button (`studioPresetProviderClassic`, MC-3970; interim until #706, MC-4041).
4. **파라미터 (Parameters)**, 3.3, in classic's order (`allBasicParameterItems` without `generationSeed`), then stop strings and logit bias.
5. **프롬프트 (Prompt)**, 3.4, without a template. With one: the line `studioPresetUsesTemplate` and the button `studioPresetEditTemplateItems` (classic prompt page; MC-3971) instead of the fields.
6. **프롬프트 옵션 (Prompt options)**, 3.5, shown whatever the template (MC-4031); ends with the toggles link row.
7. **대체 모델 (Fallback)**, 3.6, with the MC-3972 note.
8. **기타 (Other)**, 3.7.

**Toggles link row (design default).** `customPromptTemplateToggle` belongs to the toggles kind (#650's builder). The prompt options section shows one row "Custom Toggles · {n}" that selects `kind=toggles` of the same preset; it never edits the text here (one editor per value, as SLICE4 §4.2's character toggle row). `templateDefaultVariables` is edited here (classic places it beside the toggles; the character equivalent `defaultVariables` lives in the character advanced form).

**Phone layout.** One column; list rows (bias, stop strings, fallback models) become cards with stacked controls, as SLICE4 §4.2's bias rows. Targets ≥ 44 px.

## 3. Field inventory

Columns: **Path** = the new registry path (section 6.1); **Slot / db** = `botPreset` property and working property (one name when equal; "slot only" = written to the slot for an active preset too); **Type** = value kind; **Absent on slot** = what an inactive slot without the key reads as, taken from `setPreset` (`database.svelte.ts:2477-2594`): a constant default reads **as that value** (switching produces exactly it), **keeps** = `?? db.x`: the slot has no own value, reads **not set**, and a switch keeps the working value; **not set = off** = a plain copy or an optional container key: the absence is copied by a switch, and classic and the request treat it as off (display of both, section 4.2); **Classic** = today's editor; **Shown** = visibility, using the edited preset's own effective values and model (MC-3979, section 4.4); **St** = build stage (section 8).

### 3.1 Name and icon

| Path | Slot / db | Type | Absent on slot | Classic | Shown | St |
|---|---|---|---|---|---|---|
| `presetName` | `name` (slot only) | text; empty allowed (MC-4037) | empty | `botpreset.svelte:257` | always | a |
| `presetImage` | `image` (slot only) | text (data URL) | no icon | `BotSettings.svelte:818-852` | always; choose and remove (MC-4036) | d |

### 3.2 Model

| Path | Slot / db | Type | Absent on slot | Classic | Shown | St |
|---|---|---|---|---|---|---|
| `presetAiModel` | `aiModel` | text (model id) | keeps | `BotSettings.svelte:176` | always | b |
| `presetSubModel` | `subModel` | text | keeps | `:179` | always | b |
| `presetAuxMemory`, `presetAuxTranslate`, `presetAuxEmotion`, `presetAuxOtherAx` | `seperateModels.{memory,translate,emotion,otherAx}` | text (container) | container seed `{memory:'',emotion:'',translate:'',otherAx:''}` | `Setting/Pages/Model/AuxModelSelectors.svelte:27-39` | always; note when `db.doNotChangeSeperateModels` (4.5) | b |
| `presetModelTools` | `modelTools` | text list | `[]` | `BotSettings.svelte:803-812` | always (one "Search" switch over the list, 5.4) | c |

`seperateModelsForAxModels` is **not** shown: the flag is retired and decides nothing (`process/request/auxModelSlot.ts:8`); classic no longer shows it. `apiType`, `customAPIFormat`, `proxyRequestModel`, `openrouterRequestModel`, `customProxyRequestModel` are provider-specific and stay in classic (MC-3970).

### 3.3 Parameters

Every number is stored in classic's own unit; the control shows classic's scale (temperature and both penalties are stored 0..200 and shown ×0.01, `botSettingsParamsData.ts:66-69, :88-91, :103-106`). A "disableable" slider stores the sentinel `-1000` for "off" (`UI/GUI/SliderInput.svelte:16-26`); Studio uses the same sentinel, so `-1000` is an ordinary number value.

| Path | Slot / db | Type | Absent on slot | Classic item (`botSettingsParamsData.ts`) | Shown (own model) | St |
|---|---|---|---|---|---|---|
| `presetMaxContext` | `maxContext` | number ≥ 0; warning above the model limit (`actualMax`) | keeps | `params.maxContext` | always | b |
| `presetMaxResponse` | `maxResponse` | number 0..2048 | keeps | `params.maxResponse` | always | b |
| `presetThinkingType` | `thinkingType` | enum `off`/`budget`/`adaptive` | `'budget'` | `params.thinkingType` | flag `claudeThinking` or `claudeAdaptiveThinking`; options gated as classic | b |
| `presetDeepseekThinkingType` | `deepseekThinkingType` | enum `off`/`enabled` | `'off'` | `params.deepseekThinkingType` | flag `deepSeekThinkingToggle` | b |
| `presetThinkingTokens` | `thinkingTokens` | number −1..64000 step 200, disableable; `null` = not set | `null`, shown off (4.2) | `params.thinkingTokens` | parameter `thinking_tokens` and resolved thinking type `budget` | b |
| `presetAdaptiveThinkingEffort` | `adaptiveThinkingEffort` | enum `low`/`medium`/`high`/`xhigh`/`max` (`xhigh` only with `claudeXHighEffort`) | `'high'` | `params.adaptiveThinkingEffort` | flag `claudeAdaptiveThinking` and resolved type `adaptive` | b |
| `presetDeepseekReasoningEffort` | `deepseekReasoningEffort` | enum `high`/`max` | `'high'` | `params.deepseekReasoningEffort` | flag `deepSeekThinkingToggle` and this preset's DeepSeek thinking `enabled` | b |
| `presetTemperature` | `temperature` | number 0..200, disableable | keeps | `params.temperature` | parameter `temperature` | b |
| `presetTopK` | `top_k` | number 0..100, disableable | keeps | `params.topK` | `top_k` | b |
| `presetMinP` | `min_p` | number 0..1, disableable | not set = off | `params.minP` | `min_p` | b |
| `presetTopA` | `top_a` | number 0..1, disableable | not set = off | `params.topA` | `top_a` | b |
| `presetRepetitionPenalty` | `repetition_penalty` | number 0..2, disableable | not set = off | `params.repetitionPenalty` | `repetition_penalty` | b |
| `presetReasonEffort` | `reasonEffort` / db `reasoningEffort` | number enum −1/0/1/2/3, options gated as classic | `0` | `params.reasoningEffort` | any `reasoning_effort*` parameter | b |
| `presetVerbosity` | `verbosity` | number enum 0/1/2 | `1` | `params.verbosity` | `verbosity` | b |
| `presetTopP` | `top_p` | number 0..1, disableable | `1` | `params.topP` | `top_p` | b |
| `presetFrequencyPenalty` | `frequencyPenalty` | number 0..200, disableable | keeps | `params.frequencyPenalty` | `frequency_penalty` | b |
| `presetPresencePenalty` | `PresensePenalty` | number 0..200, disableable | keeps | `params.presencePenalty` | `presence_penalty` | b |
| `presetLocalStopStrings` | `localStopStrings` | text list, nullable: `null` = off | not set = off (plain copy) | `BotSettings.svelte:541-574` | model `textgen_webui`, `mancer`, `local_*` or `hf:::*` (classic's condition, `:513`; MC-4040) | c |
| `presetBias` | `bias` | bias list `[string, number][]`, value −101..100 | keeps | `BotSettings.svelte:646-700` | always; import/export JSON (MC-4039) | c |

`generationSeed` (`params.seed`) is a **global** working setting, not a preset field; it is not shown.

### 3.4 Prompt (only without a prompt template)

"Without a template" = the preset's effective `promptTemplate` is null or absent after `normalizePromptTemplate` (active: `db.promptTemplate`; inactive: the slot's, `database.svelte.ts:2507`).

| Path | Slot / db | Type | Absent on slot | Classic | Control | St |
|---|---|---|---|---|---|---|
| `presetMainPrompt` | `mainPrompt` | text | keeps | `BotSettings.svelte:861` | LT cbs, token chip | a |
| `presetJailbreak` | `jailbreak` | text | keeps | `:864` | LT cbs, chip | a |
| `presetGlobalNote` | `globalNote` | text | keeps | `:867` | LT cbs, chip | a |
| `presetFormatingOrder` | `formatingOrder` | text list of `FormatingOrderItem` | keeps | `:870` (`SideBars/DropList.svelte`) | reorder list (move up/down only, as classic) | c |
| `presetPromptPreprocess` | `promptPreprocess` | bool | keeps | `:872` | switch | a |

### 3.5 Prompt options

`promptSettings.*` paths live in the container `promptSettings`, whose absent-or-null slot value reads as `setPreset`'s object `{assistantPrefill:'', postEndInnerFormat:'', sendChatAsSystem:false, sendName:false, utilOverride:false, maxThoughtTagDepth:-1}` (`database.svelte.ts:2519-2526`; the seed, section 6.4).

| Path | Slot / db | Type | Absent on slot | Classic (`PromptSettings.svelte`) | Shown | St |
|---|---|---|---|---|---|---|
| `presetPostEndInnerFormat` | `promptSettings.postEndInnerFormat` | text | seed `''` | `:264` | always (MC-4031) | a |
| `presetSendChatAsSystem` | `promptSettings.sendChatAsSystem` | bool | seed false | `:266` | always (MC-4031) | a |
| `presetSendName` | `promptSettings.sendName` | bool (label "Format Group in Single") | seed false | `:267` | always (MC-4031) | a |
| `presetTrimStartNewChat` | `promptSettings.trimStartNewChat` | bool, optional key | not set = off | `:268` | always (MC-4031) | a |
| `presetUtilOverride` | `promptSettings.utilOverride` | bool | seed false | `:269` | always (MC-4031) | a |
| `presetCustomChainOfThought` | `promptSettings.customChainOfThought` | bool, optional key | not set = off | `:275-279` | `db.showUnrecommended` (global), or while on, latched for the visit as the character form's gated fields (design default) | a |
| `presetMaxThoughtTagDepth` | `promptSettings.maxThoughtTagDepth` | number (integer) | seed −1 | `:281` | always (MC-4031) | b |
| `presetJsonSchemaEnabled` | `jsonSchemaEnabled` | bool | false | `:270` | always (MC-4031) | a |
| `presetOutputImageModal` | `outputImageModal` | bool | false | `:271` | always (MC-4031) | a |
| `presetStrictJsonSchema` | `strictJsonSchema` | bool | **true** | `:273` | always (MC-4031) | a |
| `presetJsonSchema` | `jsonSchema` | text | `''` | `:307` | schema on; parse hint (4.6) | a |
| `presetExtractJson` | `extractJson` | text (one line) | `''` | `:309` | schema on | a |
| `presetGroupOtherBotRole` | `groupOtherBotRole` | enum `user`/`system`/`assistant` | `'user'` | `:283-287` | always (MC-4031) | a |
| `presetTemplateDefaultVariables` | `templateDefaultVariables` | text | `''` | `:291` | always (MC-4031); LT plain mono | a |
| `presetAutoSuggestPrompt` | `autoSuggestPrompt` | text | keeps | `:295` (placeholder `defaultAutoSuggestPrompt`) | always (MC-4031); LT cbs | a |
| `presetGroupTemplate` | `groupTemplate` | text | `''` | `:297` | always (MC-4031); LT cbs | a |
| `presetSystemContentReplacement` | `systemContentReplacement` | text | `''` | `:299` | always (MC-4031); LT cbs | a |
| `presetSystemRoleReplacement` | `systemRoleReplacement` | enum `user`/`assistant` | `'user'` | `:301-304` | always (MC-4031) | a |

### 3.6 Fallback

| Path | Slot / db | Type | Absent on slot | Classic | Shown | St |
|---|---|---|---|---|---|---|
| `presetFallbackWhenBlank` | `fallbackWhenBlankResponse` | bool | false | `PromptSettings.svelte:334` | always (MC-4031); note when `db.doNotChangeFallbackModels` | a |
| `presetFallbackModel`, `presetFallbackMemory`, `presetFallbackTranslate`, `presetFallbackEmotion`, `presetFallbackOtherAx` | `fallbackModels.{model,memory,translate,emotion,otherAx}` | text list (model ids, blank allowed) | container seed: five `[]` (`database.svelte.ts:2568-2574`) | `PromptSettings.svelte:312-352` | always (MC-4031); same note | c |

### 3.7 Other

| Path | Slot / db | Type | Absent on slot | Classic | Shown | St |
|---|---|---|---|---|---|---|
| `presetModuleIntegration` | `moduleIntergration` | text | `''` | `BotSettings.svelte:799-801` | always; LT plain | a |
| `presetUseInstructPrompt` | `useInstructPrompt` | bool | false | **`OpenrouterSettings.svelte:21`** (provider block) | only when the preset's own model is OpenRouter (`aiModel` starts with `openrouter`, classic's `BotSettings.svelte:637`; read only on OpenRouter paths: the request branch, `request/openAI/requests.ts:460-464`, and `utilityRefusal`, `process/utility/utilityConversation.svelte.ts:144`; MC-4034) | a |
| `presetAutoSuggestPrefix` | `autoSuggestPrefix` | text (one line) | keeps | none | always, with the note `studioPresetNotUsed` (no reader outside storage; MC-4045); kept by the preset save from S4a on (4.9, MC-4032) | a |
| `presetAutoSuggestClean` | `autoSuggestClean` | bool | keeps | none (read in chat only while the auxiliary model is `textgen_webui`, `mancer` or `local_*`: `ChatScreens/DefaultChatScreen.svelte:900`, `ChatShell/ShellComposer.svelte:222`) | always, with the note `studioPresetAutoSuggestCleanModels` naming those models (MC-4046); kept by the preset save from S4a on (4.9, MC-4032) | a |
| `presetDynamic<Key>` ×7 (`AutoAdjustSchema`, `Messages`, `Memory`, `ResponseTiming`, `OutputPrompt`, `ShowTypingEffect`, `Request`) | `dynamicOutput.<key>` (`DynamicOutput`, `database.svelte.ts:842-850`) | bool (container) | not set = off (each key; an absent container reads every key not set, 6.4) | none | always, with the note `studioPresetNotUsed` "Not used by this version yet." (no reader outside storage, MC-4033) | a |

### 3.8 Stays in classic for now (link only; each has a filed follow-up, MC-4030)

- **Prompt template item list** (`promptTemplate`): MC-3971, ticket #707; button in the Prompt section. Classic's "Use prompt template" switch (`BotSettings.svelte:741-750`), which turns a no-template preset into a template preset by writing `promptTemplate = []`, belongs with the item list and moves with #707 (design default; lane A adds it to #707's scope).
- **Provider-specific blocks** (MC-3970, MC-4041): their own later ticket #706 with its own spec; #682 keeps the classic link (2, Model section) until then. Ooba (`ooba`, `reverseProxyOobaArgs`), NovelAI (`NAISettings`, `NAIadventure`, `NAIappendName`), AI Horde / Kobold chat format, OpenRouter provider (`openrouterProvider`, request model), reverse-proxy format and model fields, `customFlags`/`enableCustomFlags`, separate parameters (`seperateParametersEnabled`, `seperateParameters`), instruct and Jinja templates (`instructChatTemplate`, `JinjaTemplate`).
- **Connection and endpoint fields** (MC-3976): never shown; Connections link.
- **Regex** (`regex`/`presetRegex`): the regex kind, editing is #684.
- **Left out by decision:** `promptSettings.assistantPrefill` (no classic editor; MC-4035).

### 3.9 Global settings classic shows beside preset fields: not preset fields

These are top-level working settings that `setPreset`/`presetFromWorkingSettings` never copy (`database.svelte.ts:2327-2408, :2477-2594`; `fastForward/records.ts:16-30`). The form **never** renders them as fields of the preset: `OAIPrediction` (`PromptSettings.svelte:293`), `doNotChangeFallbackModels` (`:335`), `doNotChangeSeperateModels` (`Setting/Pages/Model/AuxModelSelectors.svelte:24`), `disableSeperateParameterChangeOnPresetChange`, `generationSeed`, `useStreaming`, `additionalParams` (`BotSettings.svelte:702-`), `showUnrecommended`, the nanogpt/ollama/vertex fields and every API key. Only `doNotChangeFallbackModels` and `doNotChangeSeperateModels` are **read**, for the MC-3972 notes (4.5); `disableSeperateParameterChangeOnPresetChange` governs separate parameters, which stay with #706. The switches themselves stay in Settings (MC-4043).

## 4. Behaviour

### 4.1 Routing

The adapter table (`PRESET_FIELDS`, 6.2) names per path the slot property, the db property or "slot only", the container and key, the value kind, the absent rule and the unset representation. Each read and write resolves by id, then:

- **Active, ordinary field → `db.<dbProp>`**: `saveCurrentPreset` rebuilds the slot from `db.*` (`database.svelte.ts:2452`), so a slot write would be overwritten at the next save or switch.
- **Inactive → `slot.<slotProp>`**: `db.*` belongs to the active preset; `setPreset` reads the slot on a switch.
- **Name, icon → the slot, active or not**: the save carries `slot.name`/`slot.image` (`:2432`); `setPreset` does not copy them.
- **Alias:** `reasonEffort` is db `reasoningEffort` (`settingsFields.ts:248-252`; `:2394, :2551`).
- **Containers:** a key write into an absent or null container (slot `promptSettings: null`, `db.seperateModels` on a fresh profile) first creates the container from a fresh seed equal to `setPreset`'s default (as classic `Setting/Pages/Model/AuxModelSelectors.svelte:15-19`). A container is never deleted; a write whose live reading already equals its value writes nothing and creates no container (the registry's container rule, `fieldRegistry.ts:12-20`).

### 4.2 Reading and "not set"

- **Active:** the db value. **Inactive:** the slot value. A missing, `null` or wrong-type value reads as the constant default when `setPreset` has one (`?? <constant>`), the container seed key for container fields, otherwise **not set** (`{ had: false }`). The form shows what the classic page would show after switching.
- **Display of not set** (design default), by the section 3 class:
  - **keeps** rows: an empty control (a switch shows off). On an **inactive** preset the note `studioPresetNotSet` sits under the label, because a switch keeps the working value. The active preset has no switch to describe, so no note.
  - **not set = off** rows (`min_p`, `top_a`, `repetition_penalty`, `localStopStrings`, `thinkingTokens`, the optional `promptSettings` keys `trimStartNewChat` and `customChainOfThought`, the `dynamicOutput` keys): the control's off state (slider unchecked, switch off, stop strings off), no note, active or not. A switch copies the absence, and the request omits the value. Showing `thinkingTokens` `null` as off is a design default: classic's slider shows `null` as checked (its check is `value !== -1000 && value !== undefined`, `SliderInput.svelte:19`), while the request treats `null` as off (`request/anthropic.ts:405-406`).
  - **Name and icon** (slot only): an empty name field or the no-icon tile, no note.
- Editing a not-set field is allowed (`editWhenAbsent: true`); the step's `before` is `{ had: false }`.
- **Known limitation (wrong-typed slot value).** A slot value of the wrong type (an imported `temperature: "80"`) reads as not set or as the default, although `setPreset` would copy it as is. An edit followed by undo then deletes the key or writes the default; the foreign value is not put back.

### 4.3 Writing "not set"

- **Added in S4c (PR 736):** the service entry `clearField` also writes `{ had: false }`, as one step of its own. It turns a preset's stop strings off, and S4d uses it to remove the icon. It refuses `precondition` for a path a builtin owner kind holds and for a path outside the owner kind's row, so it reaches only session-only paths and cannot turn a risky flag on. A path that is already not set changes nothing.
- Otherwise only undo, redo, revert or a restore point write `{ had: false }`: the key is deleted, except `localStopStrings` and `thinkingTokens`, which get `null` (what save and `setPreset` produce, `:2362, :2395, :2513, :2552`). Read-after-write is `{ had: false }`.
- **The working copy never loses a required setting.** A `{ had: false }` write onto the **active** copy of a "keeps" field (main prompt, temperature, model, ...) is refused `precondition` before anything is written. It arises when an edit made while inactive is undone after the preset became active; deleting `db.mainPrompt` would break the request path. The step stays (check hook, 6.3).
- A `{ had: false }` write of a **not set = off** field onto the active copy is allowed: the key is deleted (or set `null`), which is what a switch to a preset without it leaves.
- **A restore point is refused whole** when its batch holds a `{ had: false }` write of a keeps field onto the now-active copy (the hook sees the whole batch): a restore point taken while the preset was inactive, before a keeps field was first set, cannot be applied after switching to it, and none of its other paths are restored either. The refusal reads as any precondition refusal ("changed elsewhere").

### 4.4 Model-dependent visibility (MC-3979)

- The model is the preset's **effective** main model: active `db.aiModel`; inactive `slot.aiModel`, or, when absent, `db.aiModel` (what switching keeps). `modelInfo = getModelInfo(model)`.
- Each parameter row uses the classic item's own `condition` and segment `condition`s from `botSettingsParamsData.ts`, evaluated with a context whose `modelInfo` is the preset's and whose `db` view is the preset's effective values (`thinkingType`, `deepseekThinkingType`, `aiModel`). If `SettingContext.db`'s `Database` type blocks a narrow view, the build narrows the condition parameter type in `botSettingsParamsData.ts` instead of casting (AGENTS.md: no lazy `unknown`).
- `maxContext`'s warning uses `getModelContextLimit(modelInfo, db)` with the preset's model.
- A field that is hidden by visibility keeps its stored value; changing the model never writes another field.
- **Changing the model has no side effects in Studio (traced).** `ModelList.changeModel` only asks before a one-source model (`UI/ModelList.svelte:38-50`); Studio reuses it, so the same question appears. Classic's page-mounted `$effect` rewrites `db.thinkingType` `budget` → `adaptive` for a model without budget thinking (`BotSettings.svelte:137-142`), which the request also resolves at send time (`request/anthropic.ts:378`); Studio does not write it and shows the resolved value (design default). The other effect (`useStreaming`, `:110-114`) writes a global setting. No other `$effect` reads `db.aiModel` (grep, non-test `src`).

### 4.5 "Do not change on preset switch" notes (MC-3972)

| Global switch on | Fields | Inactive preset | Active preset |
|---|---|---|---|
| `doNotChangeFallbackModels` | fallback lists, fallback when blank | note `studioPresetFallbackKept` (MC-4047): the edit is stored in the slot, but switching to this preset keeps the current values (`setPreset` skips them, `:2567-2576`), and switching away again saves the current values over it (the save always writes them, `:2404-2405`) | none: the edit changes the working value and is saved into this preset |
| `doNotChangeSeperateModels` | the four auxiliary models | note `studioPresetAuxKept` (MC-4047): `setPreset` skips them (`:2558-2566`), and switching away again saves `seperateModels: null` over the edit (`:2402`), which reads as four empty models later | note `studioPresetAuxNotSaved` (design default): the save writes `seperateModels: null` into the slot while the switch is on (`:2402`), so the edit changes the current setting only |

The note sits under the section header, `role="status"`, and names the switch by its classic label. It links to nothing (the switch is global and stays in Settings, MC-4043). The overwrite is disclosed, not prevented (MC-4047): it is upstream's behaviour for these switches, and no save mechanism changes.

### 4.6 JSON schema hint (MC-3977)

- Shown under `jsonSchema` while schema is on and the text is not empty. Never blocks a write.
- Uses the request's parser: `convertInterfaceToSchema` (`process/templates/jsonSchema.ts:7-124`). That function runs `risuChatParser` on interface text, and CBS can set chat variables (`parser/chatVar.svelte.ts:63` `setChatVar`), so the hint must not run CBS. The build splits the post-CBS line parser into an exported pure function used by `convertInterfaceToSchema` itself (request behaviour unchanged) and by the hint: JSON text → `JSON.parse`; interface text without `{{` → the pure line parser; interface text containing `{{` → no verdict, line `studioPresetSchemaMacros` "Contains macros, so it is checked when a request is sent." (design default).
- Failure text: `studioPresetSchemaInvalid` "This schema doesn't parse: {error}. It is saved as is; requests that use it will fail." with `{error}` the thrown message (`jsonSchemaSyntaxError`, `jsonSchemaUnsupportedType` or the `JSON.parse` message).
- Recomputed from the live text on render (debounced with the LT pause), never cached in a component.

### 4.7 Name and icon

- **Name:** single line, composition gate as the character form's lines; writes `slot.name`. Empty is allowed, as classic (MC-4037); the tree and lists already fall back (`presetNameOf` shows the id).
- **Icon:** a 32 px tile (the image or `noImages`) and the button "Choose icon image" (`chooseIconImage`). The pick and encode are classic's: `selectSingleFile(['png','jpg','jpeg','webp'])`, draw to a 48x48 canvas, `toDataURL('image/jpeg', 0.7)`. The build extracts that block from `BotSettings.svelte` into one helper used by both classic and Studio, so the two cannot drift. Studio has no picture handling to reuse (no Studio component picks files; grep of `src/lib/Studio`, non-test). The data URL is a text value on the slot (`presetImage`), one history step; no asset store, no asset history, no file is kept. Undo puts the previous data URL (or no icon) back. A cancelled pick writes nothing. Classic's preview shows the icon beside the preset name; the Studio tile sits beside the name field.
- **Remove icon (MC-4036):** a text button `studioPresetIconRemove` under the tile, shown while the preset has an icon. It writes "not set" (deletes `slot.image`; the next save writes `image: '`, `database.svelte.ts:2432`) as one undoable step.

### 4.8 Undo, redo and restore per operation

All preset steps are `set` ops (section 6.5), so the existing replay rules apply unchanged: undo writes `before` only when the live value equals `after`, redo writes `after` only when it equals `before`, else the step is refused `precondition` ("changed elsewhere"). A restore point captures each path's value at the first edit of the visit and restores paths whose live value still equals the last Studio value. Undo and redo resolve active/inactive **at that moment**: an edit made while the preset was inactive and undone after switching to it is undone on the working copy (and the reverse).

| Operation | Ops in the step | Coalescing | Notes |
|---|---|---|---|
| Text typing (LT, lines) | one `set` | by path, 1 s (`COALESCE_MS`) | as today's toggle text |
| Switch, select, enum | one `set` | none | |
| Number input, slider drag | one `set` | by path | a drag is one step |
| Disableable slider on/off | one `set` | none | off = `-1000` |
| List add / remove / move / entry edit / clear | one `set` of the whole list | entry typing coalesces by path; the rest none | section 6.5 |
| Stop strings on/off | one `set` (`[]` ↔ not set) | none | |
| Model tools "Search" | one `set` of the list (add or remove `'search'`, other entries kept) | none | |
| Icon pick | one `set` | none | |
| Icon remove | one `set` (to not set) | none | |
| Bias import | one `set` of the whole list | none | replaces the list, as classic |
| Bias export | none | — | writes a file only |

A step's label is the path's `FIELD_PRESENTATION` label (`{ kind: 'field' }`), as today.

### 4.9 The preset save keeps auto-suggest prefix and clean (MC-4032)

- Today `setPreset` reads `autoSuggestPrefix` and `autoSuggestClean` from a slot (`database.svelte.ts:2505-2506`), but `presetFromWorkingSettings` writes neither (`:2328-2408`), so the save-on-switch of a preset drops both from its slot. Upstream's save drops them too (`drive/tests/upstreamPresetMirror.ts:64-77`, transcribed from upstream `4d87a70ff`).
- Fix (S4a): `presetFromWorkingSettings` writes `autoSuggestPrefix: db.autoSuggestPrefix` and `autoSuggestClean: db.autoSuggestClean`. Both keys already exist in `botPreset` and in `PRESET_FIELD_RULE` (`str`, `bool`, `settingsFields.ts:234`) and in `PRESET_RECORD_FIELDS`; the page save and the fast-forward replay share the function (`savedPresetFor`, `fastForward/prepare.ts:72`), so the two stay equal.
- Consequence: every slot saved from then on carries both keys (the working values default to `""` and `true` at load, `database.svelte.ts:393-395`). Suites that pin a saved preset's exact keys (for example `drive/tests/binGoldens.test.ts`, `storage/tests/store2/ffRecords.test.ts`, `drive/tests/rtb/*RoundTrip*.test.ts`) are run and their expectations updated deliberately; goldens are regenerated only through their documented step, never by a folder run. Persisted-output change: opus-reviewer at S4a's Gate 2.

## 5. Interaction by value type

### 5.1 Text

Long text uses LT (SLICE3) with the mode named in section 3; token chips follow SLICE3 §7 (the chip counts with the active preset's model and names it, also on an inactive preset's texts; SLICE3 unchanged, MC-4038). Single-line text (`extractJson`, `autoSuggestPrefix`, name) uses the composition gate.

### 5.2 Bool and enum

Switches (`CheckInput` styling of Studio) and selects/segmented controls offering exactly classic's options. A stored enum value outside the options (an imported slot) shows as an extra disabled option "{value} (unknown)" so it is visible and not silently replaced (design default); choosing another option replaces it.

### 5.3 Number

`NumberInput`/`SliderInput` with classic's min, max, step, `fixed` and `multiple`. Typed values outside the range are clamped as classic's controls clamp; non-finite input writes nothing. Disableable sliders keep classic's check-then-slider pair.

### 5.4 Lists

- **Fallback model lists and stop strings:** rows of one control each (`ModelList blankable` or a text input) with a remove button per row (classic removes only the last fallback; Studio removes any row, design default), an add button, and move up/down per row (design default; order is the fallback order, `request/request.ts:264`). Known limitation: loading the profile strips blank entries from the working `fallbackModels` (`database.svelte.ts:688-693`), so a blank row on the active preset disappears at the next reload, as in classic.
- **Bias:** rows of token text + value (−101..100), remove per row, add. Duplicate tokens get the info note "같은 토큰이 있어요" as SLICE4 §4.2 (design default). **Import and export JSON (MC-4039):** export downloads `bias.json` holding `JSON.stringify(list, null, 2)` (`BotSettings.svelte:685-688`); import picks one `.json` file and replaces the whole list as one step (`:689-698`). Classic stores any parsed array; a file whose entries are not all `[string, finite number]` is refused whole with the note "This file isn't a bias list" and nothing is written (MC-4042). A stored bias value that is not a valid bias list shows read-only with the existing note `studioBiasUnreadable` and nothing writes it, as the S2 character bias does (lane A confirmation on PR 736, 2026-11-24).
- **Format order:** move up/down only; no add or remove (classic `DropList`). Unknown items in a stored list are shown and kept.
- **Model tools:** one "Search" switch; any other stored entries are kept untouched.
- Every list operation is one step; an empty list is stored as `[]` (except stop strings' off state).

### 5.5 Classic parity (MC-4030)

Checked per covered field against `BotSettings.svelte`, `PromptSettings.svelte`, `Setting/Pages/Model/AuxModelSelectors.svelte`, `UI/ModelList.svelte`, `SideBars/DropList.svelte` and `botpreset.svelte`. Added to revision 1:

- **Model pickers** reuse classic's `ModelList` unchanged (through `onChange`): providers grouped, AI Horde list, custom models, the picker's own "Show Unrecommended" check, status tag and warning, source note, the one-source confirm, and "None" on the blankable aux and fallback pickers (`ModelList.svelte:38-164`).
- **Model data refresh** row under the model pickers (`Model/ModelDataRefresh.svelte`; a global refresh, no preset write).
- **Help:** every classic `Help` key on a covered field (`model`, `submodel`, `mainprompt`, `jailbreak`, `globalNote`, `formatOrder`, `groupOtherBotRole`, `defaultVariables`, `autoSuggest`, `groupInnerFormat`, `systemContentReplacement`, `systemRoleReplacement`, `jsonSchema`, `extractJson`, `customChainOfThought` with its unrecommended tag, `moduleIntergration`, `bias`, `tempature`; `customPromptTemplateToggle` on the toggles row) opens SLICE4 §2's inline disclosure; the dynamic output switches use the existing `help.*` texts (`en.ts:1446-1453`).
- **Placeholders:** auto suggest (`defaultAutoSuggestPrompt`), non-speaker inner format (`PromptSettings.svelte:297`).
- **Counts and limits:** token counts of main prompt, jailbreak and global note (classic `BotSettings.svelte:862-868`) as LT chips; slider "Disabled" text; the max-context warning above the model limit; bias value bounds −101..100.
- **Lists:** fallback add and remove with "Model {n}" row labels; stop strings on/off plus add/remove; bias add, remove, import, export; format order up/down. Classic's format order moves the first item down on "up" and the last item up on "down" (`DropList.svelte:13-44`); Studio disables those two buttons instead (design default; no capability is lost).
- **Icon:** preview, choose image, plus remove (MC-4036).
- **Not carried:** classic's page-mounted thinking type rewrite (a side effect, not an affordance; 4.4).

## 6. Engine changes

### 6.1 Registry rows (append-only)

- One `FIELD_SPECS` row per path in section 3, appended after `translatorNote`, in section 3's order: `value` (`'text'`, `'bool'`, `'number'`, `'textList'` or `'biasList'`), `holders: []`, `absent: 'keep'` (unused: `absent` is applied by builtin-holder writers only), `editWhenAbsent: true`, **no `property`**. One `FIELD_PRESENTATION` row each: `labelKey` (an existing top-level `en.ts` key where one exists, section 9), focus `{ form: 'studio-preset-advanced-form', part: 'studio-preset-<path>' }` (made live by the focus change below).
- **Flat paths, `preset` prefix.** A path is a stable identity, never required to equal the holder property (`fieldRegistry.ts:8-11`). Every path is flat (no dot), so the dotted-path rule (character-held containers of `CONTAINER_SEEDS`, `fieldRegistry.ts:12-20`, frozen test F-d′) is untouched; the nesting lives in the adapter table. The `preset` prefix keeps the paths apart from any later character or module path of the same property name (a character `bias` list is planned in S2, MC-3900), because a shared path must share its facts.
- **Empty holders.** `holders: []` makes the path session-only: no builtin kind's set row, restore row, reader or writer includes it, and `MissingHolderPropertyOf` is vacuous for it. The build adds a type test that a flat path with `holders: []` and no `property` type-checks, and a unit test that `SET_PATHS_BY_KIND.character/chat/module` gain nothing (section 8).
- **Session kind row.** `SESSION_OWNER_KINDS.preset.setPaths` lists `customModuleToggle` followed by every new path, so the preset's set row and restore row derive from it (`historyModel.ts:44-74`).
- The frozen-facts test appends one row per path; its rule test F-e is lifted to `['text','bool','number','textList','biasList']` in the stage that adds a kind (MC-3973 for numbers; lists by this spec).
- **Restore-order pins.** Appending rows also changes the `RESTORE_PATH_ORDER` literals pinned in `history/tests/fieldRegistry.test.ts:66`, `historySetPaths.test.ts:55` and `historyModel.w0a.test.ts:104`; each stage that appends rows updates them deliberately, with the frozen test.
- **Focus after undo, redo and restore (design call: implemented, S4a).** Today `readOwnerFields` (`studio/ownerFields.ts:12-24`) resolves through `resolveLiveTarget`, which answers gone for every session key, so a preset's focus falls back. The build changes two functions. `readOwnerFields` reads a session owner through `resolveOwnerTarget` + `liveReaderOf` (`edit/ownerTargets.ts:21-38`; `greetings` `[]`). `changedFieldTarget` (`historyFocus.ts:50-68`) compares each path with `fieldValueEquals` over `{ had, value }` instead of `!==`, so a snapshotted list that did not change is never chosen (snapshots are never `===`). For character, chat and module owners text and bool compare the same either way. A target inside a collapsed section expands it first; a part hidden by visibility is not in the DOM, and focus falls back as today. Rejected: `focus: null` for every path (as `customModuleToggle`), which leaves a long form with no focus after undo.

### 6.2 Adapter table (`presetTarget.ts`)

`presetTarget.ts` stops hard-coding `customModuleToggle`. A literal table `PRESET_FIELDS: { [P in PresetPath]: PresetFieldSpec }` gives `slot` (a `keyof botPreset`), `db` (a `keyof Database` or `'slotOnly'`), optional `container`/`key`, `absent` (`{ default: value }` or `'notSet'`), `unset` (`'delete'` or `'null'`) and, for containers, the seed. `customModuleToggle` keeps its present behaviour (reads `''` when absent, `presetTarget.ts:49-59`). Compile-time checks: `slot` is a `botPreset` key, `db` a `Database` key, and the table holds exactly `SESSION_OWNER_KINDS.preset.setPaths`. The reader serves `field(path)` from the table; `write` accepts a batch whose every op is a `set` of a table path with a value of the path's kind (finite numbers; lists of the right element type), checks the whole batch before the first assignment (as today), and assigns per section 4.1/4.3. Values written are fresh plain copies; values read are snapshotted (`$state.snapshot` or a structural copy) so no history op ever holds a live proxy.

### 6.3 Session adapter check hook

`SessionOwnerAdapter` gains `check?(id, writes): 'ok' | 'precondition'`, called by `applySessionWrite` after planning and before `write`; `'precondition'` returns `refused('precondition')` with nothing written, recorded or marked. The preset adapter answers `precondition` for a `{ had: false }` write of a "keeps" field onto the active copy (4.3). `write` keeps meaning "false = gone".

### 6.4 Containers

The adapter owns three container rules (the registry's "a session owner kind that lists a dotted path owns the seed and container rule in its own adapter", applied to flat paths): `promptSettings` (seed as section 3.5, including `maxThoughtTagDepth: -1`, without `trimStartNewChat`/`customChainOfThought`), `seperateModels` (four `''`), `fallbackModels` (five `[]`), `dynamicOutput` (seven `false`). Absent or null reads as the seed, except `dynamicOutput`, whose keys then read not set (shown off, 4.2) because `setPreset` assigns it as is (`:2591`); a value write creates the container from a fresh seed copy; a container is never deleted; a container that is not a plain object (an array, a string) makes its keys read not set and refuses writes `precondition` (it cannot be written into without loss). The keeps lists (`bias`, `formatingOrder`) can be one array shared by an inactive slot and `db` (after switching between two presets that both lack the key, the save stores `db`'s array); Studio's fresh-copy writes (6.2) replace the array instead of mutating it, so a write to one never changes the other.

### 6.5 History value kinds (critical contract)

- **Number (MC-3973).** `FieldFacts.value` gains `'number'`; `FieldValue` becomes `{ had: true; value: string | boolean | number | readonly string[] | readonly BiasEntry[] }` (lists below). `parseFieldValue` accepts a finite number for a `'number'` path only; `NaN`, `±Infinity` and numbers on text or bool paths stay refusals. Every helper that splits "bool vs everything else" is changed to name each kind: `textPathsFor` returns `value === 'text'` paths only (today `!bool`, `historyModel.ts:374-376`; leaving it would let `editText` write a string into a number path), `buildFieldEdit`'s type check, `readHeld` (`studioSetters.ts:162-165`), the setter guards (`studioSetters.ts:242, :395, :598`). One helper `valueMatchesKind(path, value)` decides all of them.
- **Stored kinds.** Character, chat and module records stay readable unchanged: existing paths keep their facts and their parse branches; a stored record never holds a number or list today because no builtin-held path has those kinds, and `isOpAllowedFor` refuses a stored record that sets a session-only path. This spec registers number and list kinds for **session-only** paths. A later stored-kind number path stays possible under the registry's widening rule, but none is added: no stored field needs one, and each stored addition widens what older builds refuse.
- **Lists (MC-3974).** Two value kinds: `'textList'` (`readonly string[]`; element validation per path in the adapter: `FormatingOrderItem` for format order) and `'biasList'` (`readonly (readonly [string, number])[]`, finite numbers). A list edit is recorded as **one `set` op whose `before` and `after` are the whole list**. `fieldValueEquals` compares lists element-wise (and tuples by both members). Rejected: index-level ops like the greeting list's (character-only, `historyModel.ts:166-170, :358-362`) would thread a new op family through every replay, revert, restore and parse switch for short lists of a memory-only owner. Whole-value sets reuse all of that unchanged; the cost is the scalar rule: an undo is refused when anything in the list changed elsewhere.
- **Session kind editing intent.** `editField` needs a character target, so the service gains `editValue(owner, path, value, mode)`: an intent like `text` (reads only the live reader, no target needed) for any path in the owner kind's set row whose kind is not text, refusing a value of the wrong kind `precondition`. `editText` keeps text paths. Enum membership and numeric ranges are checked by the form's port (`presetValueAllowed(path, value)`, a pure function) before calling the service; undo, redo and restore never check them, so an unknown value read earlier can be put back exactly.

### 6.6 Dirty tracking

No Studio-side mark (as #650). A slot write is a mutation inside `db.botPresets`, which the preset effect deep-snapshots; a `db.*` write is covered by the generic loop, including a top-level key created by the write (`db.seperateModels` on a fresh profile): the loop iterates `for (const key in DBState.db)`, and Svelte's proxy tracks key additions through its own-keys read (Gate 1 read it in svelte 5.57.3 `proxy.js`: a new key's `set` increments the version and `ownKeys` reads it; S4b-T7 pins it with the real hook).

### 6.7 Mount

`StudioDetail.svelte`: `presetAdvancedFormLive = owner?.type === 'preset' && studioScreen.selectedPresetId !== null && kindNode?.kind === 'advanced'`; render `<StudioPresetAdvancedForm presetId={...}>` inside `{#key studioScreen.selectedPresetId}`; exclude it from the read-only note branch; keep the classic button. New component `src/lib/Studio/StudioPresetAdvancedForm.svelte` (plus small section components if it exceeds about 400 lines).

## 7. Changed critical contracts, compatibility, failure scenarios

Contracts changed (AGENTS.md "Gates and evidence"): persisted `botPresets` slot writes and the working copy that `saveCurrentPreset` serializes back (stages a-d); the closed `SetPath` registry and its frozen tests (a-c); the shared history value type and every owner kind's parser (b, c); the session-write path (a: check hook). Dirty-tracking dependencies are **not** changed (existing hooks), but the stages that create containers or top-level keys must prove it (6.6).

| # | Failure scenario | Guard |
|---|---|---|
| F1 | An edit to the **active** preset lands on its slot; the next switch or save rebuilds the slot from `db.*` and the edit is silently lost. | Routing by id at each write; test S4a-T2. |
| F2 | An edit to an **inactive** preset lands on `db.*`: the current chat's settings change, and the edit is saved into the wrong preset at the next switch. | Same; S4a-T2. |
| F3 | Name or icon of the active preset written to `db` (no such working field) or not to the slot: lost at save. | Slot-only rows; S4a-T3, S4d-T1. |
| F4 | An inactive slot read without `setPreset`'s defaults shows a different value than the user sees after switching (for example strict schema off instead of on). | Absent rules from `setPreset`; S4a-T4. |
| F5 | Undo after a switch deletes a required working setting (`db.mainPrompt`). | Check hook; S4a-T5. |
| F6 | A list `before` captured as a live proxy; a later edit changes the recorded history, and undo restores the wrong list. | Snapshot on read, copy on write; S4c-T3. |
| F7 | Number widening makes a stored character/module record unreadable, or makes a string accepted on a number path. | Kind-specific parser; S4b-T1..T3. |
| F8 | A slot or db write not marked for saving. | Existing hooks; S4a-T6, S4b-T7, S4c-T6. |
| F9 | A write to a nested key of a `null` slot container throws or writes a partial container that `setPreset` then reads differently. | Fresh seed equal to `setPreset`'s; S4a-T7. |
| F10 | The save-on-switch drops a preset's auto-suggest prefix and clean (today's defect). | MC-4032 fix; S4a-T16. |
| F11 | With a `doNotChange*` switch on, an inactive preset's fallback or aux edit is overwritten when that preset is switched to and away again (upstream's switch behaviour). | Disclosed, not prevented (MC-4047): note copy; S4a-T13, S4b-T8. |
| F12 | A not-set note says a value carries over where a switch drops it (plain copies), or speaks of switching on the active preset. | Split display (4.2); S4a-T20, S4b-T13. |

**Compatibility (MC-175, MC-223, MC-774, MC-350): confirmed, no format change.** One persisted-output change (S4a, MC-4032): the preset save writes `autoSuggestPrefix` and `autoSuggestClean`, keys `botPreset` and `PRESET_FIELD_RULE` already have; upstream's own save drops them as it does today, so nothing is lost relative to today. No new `botPreset` key (the `PRESET_FIELD_RULE` mapped type makes any new key a build error, `settingsFields.ts:222-226`); no new `Database` key; no migration. Values written have the types the slot already holds: strings, booleans, finite numbers, arrays of those, `null` only where the producer writes `null` (`thinkingTokens`, `localStopStrings`). Enum fields are written only with classic's option values (unknown stored values are kept, never invented). The `.bin` shape is unchanged in both directions; `.rtb` and fast-forward merge (`PRESET_RECORD_FIELDS`) see ordinary values. Preset history is memory-only; other kinds' stored records keep their bytes and parse unchanged (F7). MC-350: nothing here changes what is read.

## 8. Stages (MC-3975) and required tests

Order: S4a → S4b → S4c → S4d; each is one PR on #682, its own Gate 1 (Tier 2) and Gate 2; only S4d says `Closes #682`. Every stage adds its `en.ts` keys in all 8 locales and passes `localeParity` in the same PR (MC-058). Fixtures are built like the product builds presets (MC-329): slots by `presetFromWorkingSettings`/`savedPresetFor`, keyless imported slots by `presetFixture.test-helpers.ts`'s `keylessPreset`, ids by `assignPresetIds`; the real `changeToPreset`, `saveCurrentPreset` and `dbChangeEffects` hook. Component tests run in jsdom with a `$state` `DBState`. No sanitized markup is introduced; a stage that adds some uses jsdom and an identity-sanitizer falsification (MC-239).

Classes: **RR** regression reproducer (fails on the named pre-fix base for the intended defect; DESIGNED, NOT DEMONSTRATED until the build shows the pre-fix failure), **CG** compatibility guard (passes before and after; says so), **DX** diagnostic.

### S4a: form shell, scalar text/bool/enum, containers, name

Scope: sections 1, 2, 3.1 (name), 3.4 (no lists), 3.5 (no number), 3.6 (`fallbackWhenBlankResponse`), 3.7; registry rows for these paths; `PRESET_FIELDS`; container rules for `promptSettings` and `dynamicOutput`; `editValue` for bool/enum (text via `editText`); check hook; JSON schema hint and the pure parser split; notes (not in chat, not set, not used, auto-suggest clean models, template, fallback kept, provider classic); focus after history (6.1); mount; the preset save fix (4.9, MC-4032). **Gate 2: opus-reviewer** (persisted slot writes and active/inactive routing against `saveCurrentPreset`; the save's persisted output; registry append; session write path).

Files: `ts/studio/edit/presetTarget.ts`, `edit/sessionAdapters.ts`, `history/{fieldRegistry,sessionKinds,historyModel,ownerHistory.svelte}.ts`, `edit/studioSetters.ts` (shared kind helper), new `ts/studio/edit/presetFields.ts` (table and `presetValueAllowed`, if split from the adapter), `process/templates/jsonSchema.ts` (pure split), `studio/ownerFields.ts`, `studio/historyFocus.ts`, `lib/Studio/StudioDetail.svelte`, new `lib/Studio/StudioPresetAdvancedForm.svelte`, `ts/storage/database.svelte.ts` (save fix), `src/lang/*.ts`, tests (plus updated expectations of the suites named in 4.9 and the restore-order pins, 6.1).

| Id | Scenario | Class | Pre-fix base and expected failure | Fixture |
|---|---|---|---|---|
| S4a-T1 | Each new path is in the preset set row and in no builtin kind's row; flat path with `holders: []` type-checks | CG for builtin rows (pass before: rows unchanged); RR for the preset row on `48691dfaa`: `SET_PATHS_BY_KIND.preset` lacks `presetJsonSchema` | registry only |
| S4a-T2 | Write routing: active edit lands on `db.jsonSchema` and survives `changeToPreset(other)` then back; inactive edit lands on the slot, leaves `db.jsonSchema` unchanged, and appears in `db` after `changeToPreset(it)` | RR on `48691dfaa`: `presetAdapter.write` returns false for a `presetJsonSchema` set (refused as gone), so the value never lands | two presets via `savedPresetFor`, real switch |
| S4a-T3 | Name of the **active** preset written to the slot survives `saveCurrentPreset` | RR on `48691dfaa`: refused (no path) | as T2 |
| S4a-T4 | Inactive keyless slot reads: strict schema true, roles `user`, schema '' present, main prompt not set, `sendName` false from the `promptSettings` seed; equals what `setPreset` puts in a cloned db for the same slot | RR on `48691dfaa`: reader returns `{ had: false }` for every non-toggle path | `keylessPreset` + `setPreset` on a clone |
| S4a-T5 | Edit main prompt while inactive (before not set), switch to it, undo: refused `precondition`, `db.mainPrompt` unchanged, step stays. Allow arm: the same with `trimStartNewChat` (not set = off) lands and deletes the key from `db.promptSettings`. Restore arm: a restore point covering main prompt and `jsonSchema`, taken while inactive, is refused whole after the switch (4.3) | RR against a build without the check hook (S4a minus 6.3): undo deletes `db.mainPrompt`. Allow arm: RR against a hook that refuses every not-set write onto the active copy (M-a5) | keyless slot, real switch |
| S4a-T6 | A slot write and a db write each mark the save through the real hook | CG (the hooks exist before; extends `presetWriteMark` pattern) | real `dbChangeEffects` |
| S4a-T7 | Write `presetSendName` on a slot whose `promptSettings` is `null`: container created equal to the seed with `sendName: true`; `setPreset` result equals classic's for that container | RR on `48691dfaa`: refused | slot from `presetFromWorkingSettings` with `promptSettings` nullish (`:2367`) |
| S4a-T8 | Undo/redo/restore point of a bool and an enum on an inactive preset; replay after a reorder of `botPresets` still targets the same id | RR on `48691dfaa`: no `editValue`; `editField` refused `gone` | two presets, reorder |
| S4a-T9 | Gone: delete the preset with the form mounted → selection cleared with `studioRefusalPresetGone`; a write after `resolvePreset` fails is refused gone and nothing changes | CG (pass before for the toggle builder; extended to the new form) | real delete |
| S4a-T10 | JSON schema hint: valid JSON, valid interface, broken interface (`jsonSchemaSyntaxError`), unsupported type, macros (no verdict); the write lands in every case; `convertInterfaceToSchema` output unchanged for a fixed corpus | RR for the hint (no hint before); CG for the request parser (same output before and after) | text corpus |
| S4a-T11 | The hint never calls `risuChatParser` | RR against a hint that calls `convertInterfaceToSchema` directly (spy on the parser module) | macro text `{{setvar::a::1}}` |
| S4a-T12 | Visibility: no-template fields shown only without a template, template note with one; schema fields only while schema on; not-in-chat line only for inactive; `customChainOfThought` gated by `showUnrecommended` | RR on `48691dfaa`: the read-only note renders instead of the form | component, jsdom |
| S4a-T13 | Fallback-kept note shown for an inactive preset P with `doNotChangeFallbackModels` on, not for the active one, not with the switch off; its text says switching to P and away replaces the values. Studio then sets P's `fallbackWhenBlankResponse` to true while the working value is false; `changeToPreset(P)` then `changeToPreset(Q)`: P's slot holds false (MC-4047) | RR for the note (no form before); the overwrite arm is a CG (no mechanism change: it passes before and after on a slot written directly), pinning what the note discloses | component + real `changeToPreset` |
| S4a-T14 | `textPathsFor('preset')` holds the text paths only; `editText` on a bool path refused `precondition` | CG on `48691dfaa` (pass before for existing paths) | registry |
| S4a-T15 | Enum: the port refuses `groupOtherBotRole: 'bot'`; an imported unknown value is shown as an extra disabled option and is restored by undo | RR (no form before) | slot with `'bot'` |
| S4a-T16 | Preset P's slot holds `autoSuggestPrefix: 'pfx'` and `autoSuggestClean: false`; `changeToPreset(P)` then `changeToPreset(Q)`: P's slot still holds both | RR on `48691dfaa`: after the save-on-switch both keys are missing from P's slot | P built by `presetFromWorkingSettings` with the two keys added as an imported slot carries them; real `changeToPreset` |
| S4a-T17 | Fast-forward `saveInto` of the preset record equals the page save for a working database with both values | CG (equal before and after: both sides share `presetFromWorkingSettings`) | `ffPresetBinding` pattern |
| S4a-T18 | Use instruction prompt shows only when this preset's model is OpenRouter (inactive OpenRouter preset while the active one is not, and the reverse); dynamic output and auto-suggest prefix show `studioPresetNotUsed`; auto-suggest clean shows `studioPresetAutoSuggestCleanModels`; help disclosures open for every classic help key of the section | RR (no form before) | component |
| S4a-T19 | Focus: on an inactive preset, edit `presetJsonSchema`, then `presetGroupOtherBotRole`; undo twice through the history panel: focus lands on `studio-preset-presetGroupOtherBotRole`, then on `studio-preset-presetJsonSchema`; with the Prompt options section collapsed, it is expanded first. The list arm (an unchanged list path is never chosen) needs a list path and is S4c-T12 | RR on `48691dfaa`: `readOwnerFields` returns null for `preset:<id>`, so focus falls back | component, real history service |
| S4a-T20 | Not-set display (4.2): an inactive keyless preset shows `studioPresetNotSet` under main prompt; `trimStartNewChat` and a `dynamicOutput` key show off with no note; the name shows empty with no note; on the active preset with `db.mainPrompt` deleted, main prompt shows no note | RR (no form before) | `keylessPreset`, component |

Mutants (each must be killed by the named test): M-a1 swap the `active` branches in the table writer → S4a-T2; M-a2 write name to `db` when active → S4a-T3; M-a3 drop the `strictJsonSchema ?? true` absent default (read not set) → S4a-T4; M-a4 `check` hook always `ok` → S4a-T5; M-a5 `check` hook refuses every not-set write onto the active copy (no keeps class) → S4a-T5 (allow arm); M-a6 seed `promptSettings` without `maxThoughtTagDepth` → S4a-T7; M-a7 cache the resolution across calls (resolve once per form mount) → S4a-T8 (reorder/switch arm); M-a8 hint calls `convertInterfaceToSchema` → S4a-T11; M-a9 show the not-in-chat line for the active preset → S4a-T12; M-a10 batch check per op instead of whole batch (a mixed valid/invalid batch writes the first op) → adapter unit test S4a-T2b (mixed batch leaves both copies unchanged); M-a11 drop `autoSuggestClean` from the save → S4a-T16; M-a12 use instruction prompt visibility from `db.aiModel` → S4a-T18; M-a13 fallback-kept note shown with the switch off → S4a-T13; M-a14 `readOwnerFields` keeps answering null for session owners → S4a-T19; M-a15 not-set note on every not-set field (no class split) → S4a-T20; M-a16 not-set note also on the active preset → S4a-T20.

### S4b: number value type, model and parameters

Scope: MC-3973 number kind (6.5); sections 3.2 (models and the four auxiliary models), 3.3 (numbers and enums, not lists), `maxThoughtTagDepth`; `seperateModels` container; model-dependent visibility (4.4); the aux notes (4.5); classic picker reuse and the model data refresh row (5.5). **Gate 2: opus-reviewer** (shared history value type, every kind's parser, frozen tests).

Files: `history/{fieldRegistry,historyModel,ownerHistory.svelte}.ts`, `edit/studioSetters.ts`, `presetTarget.ts`/`presetFields.ts`, `setting/botSettingsParamsData.ts` (condition parameter type only, if needed), the form, `history/tests/fieldRegistry.frozen.test.ts` (rows + F-e lifted), locales, tests.

| Id | Scenario | Class | Pre-fix base and expected failure | Fixture |
|---|---|---|---|---|
| S4b-T1 | Stored character and module records written by the real commit path before the change (text, bool, restore points) parse to the same `OwnerRecord` after | CG (passes before and after; the point is after) | records produced by `commitStep` + the store serializer on the pre-change build, kept as literal bytes |
| S4b-T2 | A stored record with a number on a text path, `NaN` or `Infinity` on any path, or a set of a `preset*` path under a character key is refused whole | CG for the text-path and session-path rows (refused before too); RR for `NaN` on a number path on S4b minus the finite check | literal records |
| S4b-T3 | `editText` on `presetTemperature` with `'80'` refused `precondition`; `editValue` with `80` lands; with `'80'` refused | RR against S4b with `textPathsFor` = `!bool` (M-b2): the string lands on the number path | active preset |
| S4b-T4 | Temperature on an inactive preset: slot `temperature` set; working value unchanged; switch applies it; disable writes `-1000` | RR on S4a: no number path, write refused | two presets |
| S4b-T5 | `reasonEffort`: active writes `db.reasoningEffort`, inactive writes `slot.reasonEffort`; absent slot reads `0` | RR on S4a (refused) | as T4 |
| S4b-T6 | Visibility follows the preset's own model: inactive preset with a Claude adaptive model shows thinking mode and adaptive effort while the active preset's model is an OpenAI one; absent `slot.aiModel` falls back to `db.aiModel` | RR on S4a (no parameters section) | `getModelInfo` real table, models picked from it |
| S4b-T7 | Aux model on an active preset with no `db.seperateModels`: container created from the seed and the save marked by the real hook | CG-style proof of 6.6 (the hook exists before); fails if the generic loop missed key additions | fresh working db |
| S4b-T8 | Aux notes: inactive P + `doNotChangeSeperateModels` → kept note whose text says switching to P and away clears the models; active + switch → not-saved note. Studio sets P's `presetAuxMemory` while inactive; `changeToPreset(P)` then `changeToPreset(Q)`: P's slot `seperateModels` is `null` (MC-4047) | RR for the notes (no form before); the save and overwrite arms are CGs (no mechanism change: pass before and after) | real `changeToPreset` |
| S4b-T9 | Changing the model in Studio writes only `aiModel` (no other key of `db` or the slot changes); thinking mode shows the resolved value without a write | RR against a build that writes the resolved `thinkingType` (M-b4) | snapshot diff |
| S4b-T10 | Number coalescing: a slider drag of 10 writes within 1 s is one step; undo restores the start value | RR on S4a (no number edits) | fake clock |
| S4b-T11 | Frozen test: rows appended, F-e lists `'number'`; F-a..F-c unchanged for existing rows | CG (existing rows) | — |
| S4b-T12 | Picking a one-source model asks first (classic confirm); cancel writes nothing and records no step; confirm writes once | RR on S4a (no picker) | `alertConfirm` mocked, `addedSourceOf` fixture |
| S4b-T13 | Not-set display for numbers (4.2): on an inactive keyless preset `min_p` shows the slider unchecked with no note, `temperature` shows `studioPresetNotSet`; on the active preset with `db.min_p` undefined, off with no note. Allow arm of the check hook: edit `min_p` while inactive, switch, undo: lands, `db.min_p` deleted | RR on S4a (no parameters section) | `keylessPreset`, component, real switch |

Mutants: M-b1 `parseFieldValue` accepts any `typeof number` (drops `isFinite`) → S4b-T2; M-b2 `textPathsFor` = `!bool` → S4b-T3; M-b3 alias dropped (write `db.reasonEffort`) → S4b-T5; M-b4 Studio writes the resolved thinking type → S4b-T9; M-b5 visibility uses `db.aiModel` for an inactive preset → S4b-T6; M-b6 `fieldValueEquals` returns true for any two numbers → S4b-T4 (the temperature edit is wrongly `unchanged` and records no step); M-b7 seed `seperateModels` with `null` keys → S4b-T7; M-b8 `min_p` classed as keeps → S4b-T13 (note shown, undo refused).

### S4c: lists and list operations (MC-3974)

Scope: `textList` and `biasList` kinds (6.5); fallback model lists, bias with import and export (MC-4039), stop strings (MC-4040), model tools, format order; `fallbackModels` container. **Gate 2: opus-reviewer** (history value type widened again; whole-list replay preconditions).

Files: `history/{fieldRegistry,historyModel}.ts`, `edit/studioSetters.ts`, `presetTarget.ts`/`presetFields.ts`, the form (list rows), frozen test rows, locales, tests.

| Id | Scenario | Class | Pre-fix base and expected failure | Fixture |
|---|---|---|---|---|
| S4c-T1 | Add, remove, move, edit, clear on an inactive preset's `fallbackModels.memory`: each one step; undo of each restores the exact previous list | RR on S4b (refused, no list kind) | slot with `fallbackModels` absent (container seed) |
| S4c-T2 | Same on the active preset; then `saveCurrentPreset` + switch away and back: the list survives | RR on S4b | real switch |
| S4c-T3 | Edit bias, then mutate the live `db.bias` array outside Studio, then undo: refused `precondition`; recorded `before` unchanged by the mutation | RR against a build whose reader returns the live array (M-c1) | active preset |
| S4c-T4 | Stop strings on/off: off writes `null` on both copies; reading `null` and absent both give not set; on gives `[]` | RR on S4b | model `textgen_webui` |
| S4c-T5 | Model tools switch keeps an unknown stored entry; format order keeps unknown items and offers no add/remove | RR on S4b | slot with `['search','x']` |
| S4c-T6 | A list write on a slot and on `db` marks the save | CG | real hook |
| S4c-T7 | `fieldValueEquals` on lists: equal arrays equal, one changed element or tuple member unequal; an unchanged list edit is `unchanged` (no step) | RR on S4b (=== on arrays: unchanged edit records a step) | pure |
| S4c-T8 | Stored record with a list value on a text path, or a non-finite bias value, refused | CG/RR as S4b-T2 | literal |
| S4c-T9 | Bias export writes `bias.json` equal to `JSON.stringify(list, null, 2)` and changes nothing | RR on S4b (no export) | `downloadFile` mocked |
| S4c-T10 | Bias import on an inactive preset replaces the slot's list in one step; undo restores the old list; a malformed file is refused whole and writes nothing (MC-4042) | RR on S4b (no import) | `selectSingleFile` mocked with JSON bytes |
| S4c-T11 | Stop strings show only for this preset's textgen/Mancer/local/HF model (MC-4040) | RR on S4b | two presets, different models |
| S4c-T12 | Focus with lists: on an inactive preset whose `modelTools` and fallback lists are set, edit `presetBias`, undo: focus lands on `studio-preset-presetBias`, never on an unchanged list path earlier in registry order | RR against `changedFieldTarget` comparing with `!==` (M-c8): snapshotted lists are never `===`, so the first list path is chosen | component, real history service |

Mutants: M-c1 reader returns the live array → S4c-T3; M-c2 `fieldValueEquals` by reference → S4c-T7; M-c3 stop strings off writes `[]` → S4c-T4; M-c4 model-tools switch replaces the list with `['search']` → S4c-T5; M-c5 element check skipped for format order (accepts `'foo'` from the port) → S4c-T5 (port arm); M-c6 import appends instead of replacing → S4c-T10; M-c7 stop strings visibility from `db.aiModel` → S4c-T11; M-c8 `changedFieldTarget` compares with `!==` → S4c-T12.

### S4d: icon, and closing

Scope: section 4.7 with Remove icon (MC-4036); extract the classic pick/encode helper; `presetImage` path; closes #682. **Gate 2: native Sonnet adversarial reviewer** (slot write through the S4a-reviewed table; no new contract). If the stage reshapes the table or the routing, it takes opus instead.

| Id | Scenario | Class | Pre-fix base and expected failure | Fixture |
|---|---|---|---|---|
| S4d-T1 | Icon on the **active** preset is written to `slot.image`, survives `saveCurrentPreset` and a switch round trip; `db` gains no `image` key | RR on S4c (refused) | injected data URL (jsdom has no canvas; the helper's canvas step is mocked at the helper boundary) |
| S4d-T2 | Icon on an inactive preset; undo restores no icon (key deleted) | RR on S4c | slot without `image` |
| S4d-T3 | Classic still writes through the extracted helper (same 48x48 JPEG call sequence) | CG (classic behaviour unchanged) | mocked canvas |
| S4d-T4 | Cancelled pick writes nothing and records no step | RR (no picker before) | `selectSingleFile` → null |
| S4d-T5 | Remove icon on an inactive preset deletes its `slot.image` only (the active slot keeps its icon); undo restores the data URL; on the active preset the save writes `image: ''` | RR on S4c (no remove) | two presets with icons |

Mutants: M-d1 icon written via `setCurrentPresetImage` for every preset (always the active slot) → S4d-T2; M-d2 icon written to `db.image` when active → S4d-T1; M-d3 remove targets the active preset (`currentPresetOf`) instead of the id → S4d-T5.

## 9. Copy (new `en.ts` keys; all 8 locales in the stage that adds them, MC-058)

Reused existing top-level keys (verified in `lang/en.ts` on `48691dfaa`): `name`, `icon`, `chooseIconImage`, `noImages`, `model`, `submodel`, `parameters`, `prompt`, `promptTemplate`, `mainPrompt`, `jailbreakPrompt`, `globalNote`, `formatingOrder`, `promptPreprocess`, `postEndInnerFormat`, `sendChatAsSystem`, `formatGroupInSingle`, `trimStartNewChat`, `utilOverride`, `customChainOfThought`, `maxThoughtTagDepth`, `enableJsonSchema`, `outputImageModal`, `strictJsonSchema`, `jsonSchema`, `extractJson`, `groupOtherBotRole`, `defaultVariables`, `autoSuggest`, `groupInnerFormat`, `systemContentReplacement`, `systemRoleReplacement`, `customPromptTemplateToggle`, `fallbackModel`, `fallbackWhenBlankResponse`, `moduleIntergration`, `useInstructPrompt`, `tools`, `search`, `maxContextSize`, `maxResponseSize`, `temperature`, `frequencyPenalty`, `presensePenalty`, `thinkingType`, `thinkingTokens`, `adaptiveThinkingEffort`, `customStopWords`, `noBias`, `value`, `add`, `remove`, `none`, `disabled`, `connectionsManageLink`, `studioOpenClassic`, `studioRefusalPresetGone`, `studioBannerPresetSession`, `doNotChangeFallbackModels`, `doNotChangeSeperateModels`, `import`, `export`, `jsonSchemaSyntaxError`/`jsonSchemaUnsupportedType` (under `errors`). Option labels reuse the `opt*` keys classic's segments use.

New keys (labels are `FIELD_PRESENTATION` targets where marked †, so they must be top-level strings):

| Key | en | Stage |
|---|---|---|
| `studioPresetNotInChat` | This preset isn't the active one, so chats don't use these settings until you switch to it. | a |
| `studioPresetNotSet` (keeps fields, inactive preset only) | Not set in this preset. Switching to it keeps the current value. | a |
| `studioPresetSectionNameIcon` | Name and icon | a |
| `studioPresetSectionPromptOptions` | Prompt options | a |
| `studioPresetSectionOther` | Other | a |
| `studioPresetUsesTemplate` | This preset uses a prompt template, so the main prompt, jailbreak, global note and formatting order aren't used. | a |
| `studioPresetEditTemplateItems` | Edit template items in the classic editor | a |
| `studioPresetProviderClassic` | Provider settings (Ooba, NovelAI, AI Horde, OpenRouter, separate parameters, instruct and Jinja templates) stay in the classic editor. | a |
| `studioPresetTogglesRow` | {name} · {n} | a |
| `studioPresetFallbackKept` | "Do Not Change Fallback Models on Preset Change" is on, so these fallback settings won't apply when you switch to this preset, and switching to it and away again replaces them with the current ones. | a |
| `studioPresetSchemaInvalid` | This schema doesn't parse: {error}. It is saved as is; requests that use it will fail. | a |
| `studioPresetSchemaMacros` | Contains macros, so it is checked when a request is sent. | a |
| `studioPresetUnknownValue` | {value} (unknown) | a |
| `studioPresetAutoSuggestPrefix` † | Auto Suggest Prefix | a |
| `studioPresetAutoSuggestClean` † | Clean Auto Suggestions | a |
| `studioPresetDynamicOutput` | Dynamic Output | a |
| `studioPresetNotUsed` | Not used by this version yet. | a |
| `studioPresetAutoSuggestCleanModels` | Applies only when this preset's auxiliary model is Text Generation WebUI, Mancer or a local model. | a |
| `studioPresetDynamicAutoAdjustSchema` †, `…Messages` †, `…Memory` †, `…ResponseTiming` †, `…OutputPrompt` †, `…ShowTypingEffect` †, `…Request` † | Auto-adjust schema / Dynamic messages / Dynamic memory / Dynamic response timing / Include schema in request / Show typing effect / Dynamic request (help texts exist under `help.*`, `en.ts:1446-1453`) | a |
| `studioPresetAuxMemory` †, `studioPresetAuxTranslate` †, `studioPresetAuxEmotion` †, `studioPresetAuxOtherAx` † | Auxiliary model: memory / translation / emotion / other | b |
| `studioPresetAuxKept` | "Do Not Change Separate Models on Preset Change" is on, so these models won't apply when you switch to this preset, and switching to it and away again clears them. | b |
| `studioPresetAuxNotSaved` | "Do Not Change Separate Models on Preset Change" is on, so changes here apply to the current setting and aren't saved into this preset. | b |
| `studioPresetTopP` †, `…TopK` †, `…MinP` †, `…TopA` †, `…RepetitionPenalty` †, `…ReasoningEffort` †, `…Verbosity` †, `…DeepseekThinking` †, `…DeepseekEffort` † | Top P / Top K / Min P / Top A / Repetition penalty / Reasoning effort / Verbosity / Thinking mode (DeepSeek) / Reasoning effort (DeepSeek) (classic's `fallbackLabel` texts) | b |
| `studioPresetFallbackList` † ×5 (`…Main`, `…Memory`, `…Translate`, `…Emotion`, `…OtherAx`) | Fallback models: main / memory / translation / emotion / other | c |
| `studioPresetBias` † | Logit bias | c |
| `studioPresetBiasDuplicate` | 같은 토큰이 있어요 / The same token is listed more than once | c |
| `studioPresetModelTools` † | Model tools | c |
| `studioPresetBiasImportInvalid` (added in S4c; the reused bias note is `studioBiasUnreadable`, from S2) | This file isn't a bias list | c |
| `studioPresetIconRemove` | Remove icon | d |

Korean strings come from the translator (MC-058); the Korean in this table is SLICE4's existing wording.

## 10. Decisions this spec applies

- **This ticket:** MC-3970 (scope), MC-3971 (template items: #707), MC-3972 (every preset, per-write routing, `doNotChange*` notes), MC-3973 (number kind, opus Gate 2 in S4b), MC-3974 (lists: whole-list `set` steps, 6.5, S4c), MC-3975 (staged PRs; S4d closes #682), MC-3976 (connection fields never shown), MC-3977 (non-blocking schema hint, request parser without a CBS run), MC-3978 (the fields without a classic editor are shown), MC-3979 (visibility from the preset's own model).
- **Revision 2 answers:** MC-4030 (Studio is feature complete against classic; a classic link only as an interim step with a filed follow-up; 5.5), MC-4031 (prompt options shown with or without a template), MC-4032 (the preset save keeps auto-suggest prefix and clean; 4.9, S4a), MC-4033 (dynamic output shown with "Not used by this version yet"), MC-4034 (use instruction prompt only for the preset's own OpenRouter model), MC-4035 (assistant prefill left out), MC-4036 (Remove icon, undoable), MC-4037 (empty name allowed), MC-4038 (token chips count with the active model, named in the chip), MC-4039 (bias import and export JSON in Studio), MC-4040 (stop strings follow classic's model condition with the preset's own model), MC-4041 (provider-specific blocks: own ticket #706; classic link until then).
- **Inherited:** MC-3890 (routing by id), MC-3892 (banner), MC-3894 (no chip, #666), MC-3896 (gone); MC-3891/3893/3895 concern the toggle builder only. MC-1758 (memory-only preset history), MC-3902 (spec before build), DD-094/095/157 (Studio hosts the form; live saving with history; store-backed reads).
- **Gate 1 answers (revision 3):** MC-4042 (a bias import is refused whole unless every entry is `[string, finite number]`; nothing is written), MC-4043 (app-wide switches classic shows beside preset fields stay in Settings, an explicit exception to MC-4030; the form shows only the MC-3972 notes), MC-4044 (preset list management: #710), MC-4045 (auto-suggest prefix shown with "Not used by this version yet"), MC-4046 (auto-suggest clean always shown, with a note naming the models it affects), MC-4047 (the `doNotChange*` notes disclose that switching in and out replaces the edit; no save mechanism change).

## 11. Open questions (maintainer)

None. Revision 2's OQ-11 and OQ-12 and Gate 1 round 1's product points (S1 → MC-4045, MC-4046; S3 → MC-4047) were answered on 2026-11-23:

- **OQ-11 → MC-4042.** A bias import whose entries are not all `[string, finite number]` is refused whole with a note ("This file isn't a bias list"); nothing is written.
- **OQ-12 → MC-4043.** The form shows only the MC-3972 notes; `doNotChangeFallbackModels`, `doNotChangeSeperateModels` and `OAIPrediction` stay in Settings. MC-4030 covers the fields a Studio form owns.

Facts for lane A (not product questions):
- Follow-ups filed: #706 (provider-specific blocks, MC-4041), #707 (template item list, MC-3971, now also covering classic's "Use prompt template" switch), #710 (preset list management, MC-4044).
- #706's body now lists every field section 3.8 assigns to it (Gate 1 E5).
- #150 and #148 interact with Studio preset writes (section 1); their plans should cite this spec.
- #684's spec should reuse 6.5's whole-list `set` for the preset regex list or say why not.

## 12. Premises

| Premise | Status |
|---|---|
| Active slot is rebuilt from `db.*` by `saveCurrentPreset`; name and image carried from the slot | REOPENED (`database.svelte.ts:2431-2454`, `presetMeta.ts:85-96`) |
| `setPreset` absent-key defaults per field | REOPENED (`:2477-2594`) |
| Preset save drops auto-suggest prefix and clean; upstream's too | REOPENED (`:2328-2408`; `drive/tests/upstreamPresetMirror.ts:64-77`) |
| Preset adapter accepts only `customModuleToggle`; per-call resolution | REOPENED (`presetTarget.ts`) |
| `editField` needs a character target; session writes report false as gone | REOPENED (`ownerHistory.svelte.ts:906-913, :1218-1239`) |
| History value type text/bool only; `textPathsFor` = not bool | REOPENED (`historyModel.ts:112, :374-376`) |
| Dirty hooks cover slot and db writes | REOPENED (`dbChangeEffects.svelte.ts:125-138, :248-262`); key-addition tracking INHERITED FROM GATE 1 (svelte 5.57.3 `proxy.js:338, :344-345`) |
| `seperateModelsForAxModels` retired | REOPENED (`auxModelSlot.ts:8`) |
| `useInstructPrompt` has an editor and is OpenRouter-only | REOPENED (`OpenrouterSettings.svelte:21`; `requests.ts:460-464`, `utilityConversation.svelte.ts:144`); sizing packet's "no editor" REFUTED |
| `dynamicOutput`, `autoSuggestPrefix` have no runtime reader | REOPENED by grep (non-test `src`, excluding `lang`); absence within that query only |
| Classic prompt options: Bot settings page only with a template, standalone prompt page always | REOPENED (`BotSettings.svelte:741-750, :874-875`; `PromptSettings.svelte:133-153`; `Settings.svelte:256-257`); sizing packet's claim PARTLY REFUTED |
| Classic affordances of covered fields (5.5) | REOPENED (`ModelList.svelte`, `DropList.svelte`, `BotSettings.svelte:180, :646-700`) |
| `autoSuggestClean` read only for textgen/Mancer/local auxiliary models | REOPENED (`DefaultChatScreen.svelte:900`, `ShellComposer.svelte:222`) |
| Session owners have no focus today; `changedFieldTarget` compares with `!==` | REOPENED (`ownerFields.ts:12-24`, `historyFocus.ts:64-66`, `ownerTargets.ts:21-38`) |
| Save writes fallback always and `seperateModels: null` under the switch; load strips blank fallback entries | REOPENED (`database.svelte.ts:2402, :2404-2405, :688-693`) |
| `PRESET_FIELD_RULE` makes a new key a build error | REOPENED (`settingsFields.ts:220-226`) |
| `localNetworkMode/TimeoutSec` upstream parity | INHERITED FROM SIZING (UNCERTAIN; irrelevant: never shown, MC-3976) |