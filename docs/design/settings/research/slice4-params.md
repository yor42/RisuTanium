# Slice 4 (Parameters): source read

Date: 2026-10-28. Static read only. OBSERVED = read in the cited code; INFERRED = my reading, not run. Extends `research/today-settings.md` section 4; does not repeat it. Paths relative to repo root. `DB` = `src/ts/storage/database.svelte.ts`, `SHARED` = `src/ts/process/request/shared.ts`, `PARAMS` = `src/ts/setting/botSettingsParamsData.ts`, `BS` = `src/lib/Setting/Pages/BotSettings.svelte`.

## 1. Defaults and stored units

There are three default sources. (a) Load-time `??=` fallbacks for the live `db` (`DB:66-79, 428-494, 605-633`). (b) `presetTemplate` (`DB:2045-2078`), used by `db` reset paths. (c) `prebuiltPresets.OAI2` (`templates.ts:223-`), which is what the preset overlay "+" clones (`botpreset.svelte:300-309`, from today-settings §5). A "new preset" in the UI therefore means OAI2, not presetTemplate. OBSERVED for every cell below unless marked.

| Parameter (db field) | Stored unit, shown as | Live-db load default | presetTemplate | OAI2 (what "+" gives) | Anchor |
|---|---|---|---|---|---|
| Max context (`maxContext`) | tokens, as is | 4000 (`DB:69-70`) | 4000 | 16000 | `DB:2055`; `templates.ts:231` |
| Max response (`maxResponse`) | tokens, as is; UI field max 2048 (`PARAMS:34`) | 500 (`DB:72-73`) | 300 | 1000 | `DB:2056`; `templates.ts:232` |
| Seed (`generationSeed`) | integer; not in any preset (INFERRED, no hit in `presetFromWorkingSettings`/`setPreset`) | -1 (`DB:428`) | none | none | `DB:428` |
| Temperature (`temperature`) | integer 0-200, shown x0.01 (0.00-2.00); request divides by 100 | 80 (0.80) (`DB:66-67`) | 80 | 100 (1.00) | `PARAMS:65-70`; `SHARED:288`; `DB:2054`; `templates.ts:230` |
| Frequency penalty (`frequencyPenalty`) | integer 0-200 shown x0.01; request /100 | 70 (0.70) | 70 | 0 | `SHARED:325`; `DB:75-76,2057`; `templates.ts:233` |
| Presence penalty (`PresensePenalty`, capital P, typo "Presense") | same as above | 70 | 70 | 0 | `SHARED:329`; `DB:78-79,2058`; `templates.ts:234` |
| Top P (`top_p`) | float 0-1, step 0.01, as is | 1 (`DB:445`) | 1 | 1 | `DB:2075`; `templates.ts:392` |
| Top K (`top_k`) | integer 0-100 (UI) | 0 (`DB:464`) | none | none (see note) | `PARAMS:221-226` |
| Min P / Top A (`min_p`, `top_a`) | float 0-1 | 0 / 0 (`DB:493-494`) | none | none | `PARAMS:235,250` |
| Repetition penalty (`repetition_penalty`) | float 0-2, step 0.01 | 1 (`DB:492`) | none | none | `PARAMS:265-270` |
| Reasoning effort (`reasoningEffort`) | integer enum -1 minimal/none, 0 low, 1 medium, 2 high, 3 xhigh; mapped to strings at request | 0 = low (`DB:605`) | none (`?? 0`) | none | `PARAMS:286-292`; `SHARED:154-175`; `DB:2161,2296` |
| Verbosity (`verbosity`) | integer 0 low, 1 medium, 2 high | 1 (`DB:606`) | 1 | none (`?? 1`) | `SHARED:177-179`; `DB:2077,2335` |
| Claude thinking type (`thinkingType`) | 'off' / 'budget' / 'adaptive' | 'budget' (`DB:630`) | none | none | `PARAMS:141-146` |
| Claude thinking tokens (`thinkingTokens`) | tokens, -1 to 64000 step 200; disableable (`PARAMS:172-177`) | no `??=` found; presets use `?? null` (`DB:2162,2297`) so effectively unset/null (INFERRED) | none | none | `DB:1193` |
| Claude adaptive effort (`adaptiveThinkingEffort`) | 'low'..'max' | 'high' (`DB:632`) | none | none | `PARAMS:189-196` |
| DeepSeek thinking (`deepseekThinkingType`) / effort (`deepseekReasoningEffort`) | 'off'|'enabled' / 'high'|'max' | 'off' / 'high' (`DB:631,633`) | none | none | `PARAMS:157-160, 208-211` |

Notes.
- Preset fields a preset lacks: `setPreset` mostly falls back to `?? db.x` for temperature/context/response/penalties/top_k (`DB:2228-2232,2280`) but hard-resets some: `top_p ?? 1` (2263), `reasoningEffort ?? 0` (2296), `thinkingType ?? 'budget'` etc. (2298-2301), `verbosity ?? 1` (2335), and assigns `repetition_penalty`, `min_p`, `top_a` straight from the preset with no fallback (2272-2274). INFERRED: switching to OAI2 (no such fields) sets these three to undefined, so "default" for them depends on the preset and the request path; a design "reset to default" for these needs a decided number (load default 1 / 0 / 0 is the closest).
- Other prebuilt presets differ: NAI preset temp 135, response 500, presence 0 (`templates.ts:13-17`); OAI preset temp 80, context 4000, response 300, penalties 70 (`templates.ts:160-164`). DS-086 says "the new-preset default from today's code"; the code has three disagreeing candidates (load / presetTemplate / OAI2). Open decision.
- Service blocks keep separate defaults: `defaultOoba` (`DB:2010-2041`), `defaultAIN` (`DB:1998-2008`), `prebuiltNAIpresets` (`templates.ts:416-430`); see section 4.
- Imported NovelAI v3 presets write temperature x100; SillyTavern import writes `temperature*100`, penalties x100 (`DB:2437,2466-2469`).

## 2. "Not sent" (-1000)

| Fact | Anchor |
|---|---|
| `SliderInput` shows a checkbox (left of the slider) only when `disableable`. Checked means value is not -1000 and not undefined. Unchecking sets the value to -1000. Re-checking sets the value to `min` (not the previous value). OBSERVED. | `src/lib/UI/GUI/SliderInput.svelte:13-25` |
| While disabled, the bar is drawn at the min position and the label text is `language.disabled` ("Disabled" / ko "비활성화됨"). The previous value is lost on toggle. OBSERVED. | `SliderInput.svelte:106-109`; `en.ts:1224`; `ko.ts:1095` |
| Schema flag `disableable` documented as "Allow -1000 to disable". Set on: temperature, frequency, presence, top P, thinking tokens, top K, min P, top A, repetition penalty. NOT on max context/response (numbers), seed, or any segmented control. OBSERVED. | `types.ts:71`; `PARAMS:70,92,107,122,176,225,240,255,270` |
| Request side (live params): for temperature, frequency, presence only, -1000 is passed through as-is (no /100) then the final check `if (value === -1000) continue` omits the key from the body. OBSERVED. | `SHARED:288,325,329,338-340` |
| Request side for top_p, top_k, min_p, top_a, repetition_penalty, thinking_tokens: no special-casing, but the same `value === -1000` check at 338 drops them too (the check is on the final value for all params). OBSERVED. | `SHARED:291-310,332-340` |
| Separate-params path additionally drops `undefined`, `null`, `NaN` (so a param never set in a task block is omitted). Live path has no undefined/NaN guard (INFERRED consequence: undefined `repetition_penalty` after an OAI2 switch would go through `setObjectValue` as undefined; JSON drops it). | `SHARED:264-272` vs `338` |
| Which params are sent depends on the model's `parameters` list passed by each provider request builder (`applyParameters(data, parameters, rename, modelMode, ...)`), e.g. `anthropic.ts:356`, `google.ts:337`, `request.ts:1023,1310`, `openAI/requests.ts:289,451`, `openAI/responses.ts:342`. Reasoning-capability markers are skipped (`isReasoningCapabilityParameter`). `top_k` is also skipped when 0 if the caller sets `ignoreTopKIfZero`. OBSERVED. | `SHARED:139-148,196-201,280-285` |
| Other places set -1000: `prompt.ts:358-359` (a prompt item "unset sampler" writes -1000 into the preset). `request.ts:504` computes `arg.temperature ?? (db.temperature/100)` for another path, so -1000 would become -10 there (INFERRED, path not traced). | `prompt.ts:358`; `request.ts:504` |
| `PromptDataItem` also uses -1000 as a different sentinel (`rangeStart`), unrelated. | `PromptDataItem.svelte:46` |

## 3. Per-model limits

| Question | Answer | Anchor |
|---|---|---|
| Context limit source | `getModelContextLimit(modelInfo, db)` returns a number or undefined; it reads the downloaded OpenRouter and LiteLLM datasets (not static `LLMModel` fields), uses `db.openrouterRequestModel` for routed models, and never throws. OBSERVED. | `modelDataService.svelte.ts:148-155`; `litellmData.ts:555` |
| `LLMModel` fields | `{id,name,shortName,fullName,provider,flags,format,parameters,tokenizer,recommended,keyIdentifier,endpoint}` - no context or max-output field. OBSERVED (today-settings §3). | `src/ts/model/types.ts:118-132` |
| Max output per model | No code path found. `grep maxOutput|max_output` in `src/ts` (non-test) hits only `nanogpt.ts:18,152,184` (NanoGPT listing) and fixtures. The LiteLLM fixture has `max_output_tokens`, but the app reader exposes only context (and prices). OBSERVED by grep; the dataset field exists, no consumer found. | `nanogpt.ts:18`; `tests/litellm.fixture.json:46+` |
| Max response UI limit | Fixed `max: 2048` for every model, so models allowing more (e.g. 128000 in fixture) cannot be set above 2048 in this field. OBSERVED. | `PARAMS:34` |
| Context overshoot today | Value kept; a red warning under the number field: "This is above the model's listed maximum context of X. The provider may reject or truncate the request." Shown only when the limit is known and positive and value exceeds it. No clamp, no fix button. OBSERVED. | `SettingNumber.svelte:19-22,55-57`; `en.ts:1144-1145` |
| Response overshoot today | Nothing (no limit known, 2048 UI cap). `maxResponse` is sent as `max_tokens`/`max_new_tokens`/`maxOutputTokens` etc. unmodified (`request.ts:503,853,933`; `google.ts:338`). Context budget subtracts it (`index.svelte.ts:1056`, `hypav2.ts:374`). OBSERVED. | as listed |
| Consequence for DS-085 | "Requests use the model's maximum until fixed" needs a new max-output source (LiteLLM `max_output_tokens`) and request-side clamp; neither exists. The per-model max for context is available only after the dataset downloads (offline: undefined, no warning). INFERRED. | - |

## 4. Service-specific blocks (`BS:505-620`)

All are hand-written, English literal labels (no label keys, no help), bound to preset-scoped objects `db.ooba`, `db.NAIsettings`, `db.ainconfig` (copied by `presetFromWorkingSettings`, today-settings §4). Slider "min/max/step/fixed" are literals in markup; none use `disableable`.

Block A, Ooba/textgen. Shown when `aiModel` is `textgen_webui` or `mancer` or starts with `local_` or `hf:::` (`BS:505`). Defaults `defaultOoba` (`DB:2010-2041`).

| Label (literal) | Field | Range / step | Default | Anchor |
|---|---|---|---|---|
| Repetition Penalty | `ooba.repetition_penalty` | 1-1.5 / 0.01 | 1.15 | `BS:506-507`; `DB:2016` |
| Length Penalty | `ooba.length_penalty` | -5-5 / 0.05 | 1 | 508-509; `DB:2023` |
| Top K | `ooba.top_k` | 0-100 / 1 | 20 | 510-511; `DB:2018` |
| Top P | `ooba.top_p` | 0-1 / 0.01 | 0.9 | 512-513; `DB:2014` |
| Typical P | `ooba.typical_p` | 0-1 / 0.01 | 1 | 514-515; `DB:2015` |
| Top A | `ooba.top_a` | 0-1 / 0.01 | 0 | 516-517; `DB:2030` |
| No Repeat n-gram Size | `ooba.no_repeat_ngram_size` | 0-20 / 1 | 0 | 518-519; `DB:2021` |
| Do Sample / Add BOS Token / Ban EOS Token / Skip Special Tokens | `ooba.do_sample`, `add_bos_token`, `ban_eos_token`, `skip_special_tokens` | checks | true / true / false / true | 520-531; `DB:2012,2026-2029` |
| custom stop words (`language.customStopWords`) | `db.localStopStrings` (null or string[]; global, not in Ooba object) | add/remove text rows | null | 532-566 |
| Chat format (`ChatFormatSettings`) + `language.useNamePrefix` | `ooba.formating.*` | text fields | header/prefix strings (`DB:2034-2040`) | 567-570 |

Note: ooba temperature and max_new_tokens exist in `defaultOoba` (`DB:2011,2013`) but this block shows no temperature; the shared Temperature row (schema) and `maxResponse` feed those (INFERRED; request builder `request.ts:716` uses `db.maxResponse` for `max_new_tokens`).

Block B, NovelAI. Shown when `modelInfo.format === LLMFormat.NovelAI` (`BS:572`). Defaults `prebuiltNAIpresets` (`templates.ts:416-430`; used as the `NAIsettings` load default, `DB:401`). Labels: all English literals except starter/separator (`language.settingsPage.starter`, `.seperator`, `BS:574,576`).

| Label | Field | Range / step | Default |
|---|---|---|---|
| Starter (text, placeholder ⁂) / Separator (placeholder \n) | `NAIsettings.starter` / `.seperator` | text | "" / "" |
| Top P | `topP` | 0-1 / 0.01 | 0.85 |
| Top K | `topK` | 0-100 / 1 | 12 |
| Top A | `topA` | 0-1 / 0.01 | 0.1 |
| Tailfree Sampling | `tailFreeSampling` | 0-1 / 0.001 | 0.915 |
| Typical P | `typicalp` | 0-1 / 0.01 | 1 |
| Repetition Penalty | `repetitionPenalty` | 0-3 / 0.01 | 2.8 |
| Repetition Penalty Range | `repetitionPenaltyRange` | 0-8192 / 1 | 2048 |
| Repetition Penalty Slope | `repetitionPenaltySlope` | 0-10 / 0.01 | 0.02 |
| Frequency Penalty | `frequencyPenalty` | -2-2 / 0.01 | 0.03 |
| Presence Penalty | `presencePenalty` | -2-2 / 0.01 | 0 (default object has `repostitionPenaltyPresence`, typo, not `presencePenalty`; INFERRED mismatch) |
| Mirostat LR / Mirostat Tau / Cfg Scale | `mirostat_lr` (0-1/0.01), `mirostat_tau` (0-6/0.01), `cfg_scale` (1-3/0.01) | | not in `prebuiltNAIpresets` (undefined until set; INFERRED) |

Anchors: `BS:572-604`. That is 14 sliders plus 2 text inputs.

Block C, NovelList. Shown when `modelInfo.format === LLMFormat.NovelList` (`BS:606`). Bound to `db.ainconfig`, defaults `defaultAIN` (`DB:1998-2008`). Labels literal, including "Reputation Penalty" (sic, a mislabel of repetition).

| Label | Field | Range / step | Default |
|---|---|---|---|
| Top P | `top_p` | 0-2 / 0.01 | 0.7 |
| Reputation Penalty | `rep_pen` | 0-2 / 0.01 | 1.0625 |
| Reputation Penalty Range | `rep_pen_range` | 0-2048 / 1 | 1024 |
| Reputation Penalty Slope | `rep_pen_slope` | 0-10 / 0.1 | 1.7 |
| Top K | `top_k` | 1-500 / 1 | 140 |
| Top A | `top_a` | 0-1 / 0.01 | 0.08 |
| Typical P | `typical_p` | 0-1 / 0.01 | 1 |

Anchors: `BS:606-620`. 7 sliders.

Related conditional blocks outside the three: `OobaSettings` (reverse proxy Ooba mode or `aiModel==='ooba'`, `BS:625-627`), `OpenrouterSettings` (`aiModel.startsWith('openrouter')`, `BS:629-631`). The three blocks are mutually exclusive via if/else-if; block A is by `aiModel` string, B and C by `modelInfo.format`. A reverse-proxy model with NovelAI format would show B (INFERRED).

## 5. Others tab (`BS:637-808`)

| Control | What it is | Storage | Per-preset or global | Anchor |
|---|---|---|---|---|
| Bias (Accordion, `help="bias"`) | table of [string, number]; value input range -101 to 100; add/remove rows; JSON export and import (import replaces the whole array, only checks it is an array) | `db.bias` | per-preset (`presetFromWorkingSettings` copies bias; `DB:224`, today-settings §4) | `BS:638-692`; `en.ts:500` |
| Additional parameters (`help="additionalParams"`) | key/value text table, appended to request body; `header::` prefix = header; `json::` prefix = JSON value; `{{none}}` removes; `"x"` string; true/false/null; numeric auto | `db.additionalParams` | global: not in `presetFromWorkingSettings`/`setPreset` (OBSERVED not found; today-settings §4) | `BS:694-730`; `SHARED:104-134`; `en.ts:584-585` |
| Prompt template (Accordion) | "Use Prompt Template" check, else inline PromptSettings | `db.promptTemplate` | per-preset | `BS:733-743` (Prompt authoring is Studio, DD-094; out of slice) |
| Custom flags | check `enableCustomFlags`, then toggle buttons that add the numeric LLMFlag into `db.customFlags` | `db.enableCustomFlags`, `db.customFlags` | per-preset (`presetFromWorkingSettings` copies customFlags, today-settings §4; `enableCustomFlags` INFERRED same) | `BS:745-789` |
| Module integration (`help="moduleIntergration"`) | textarea of comma-separated module namespaces | `db.moduleIntergration` | per-preset (`DB:2142,2279`) | `BS:791-793`; `en.ts:621` |
| Tools | one check, "Search"; toggles `'search'` in `db.modelTools` | `db.modelTools` (`??= []`, `DB:644`) | per-preset (`DB:2334`) | `BS:795-804` |
| Regex script | `RegexList` bound to `db.presetRegex` | `db.presetRegex` | per-preset | `BS:806-808` (out of slice scope) |
| Icon | preset icon | | per-preset | `BS:810-` (out of scope) |

Custom flags shown (button label = raw enum name, English only, no translation, no help). Index is the `LLMFlags` numeric: hasImageInput 0, hasImageOutput 1, hasAudioInput 2, hasAudioOutput 3, hasPrefill 4, hasCache 5, hasFullSystemPrompt 6, hasFirstSystemPrompt 7, hasStreaming 8, requiresAlternateRole 9, mustStartWithUserInput 10, hasVideoInput 12, OAICompletionTokens 13, DeveloperRole 14, geminiThinking 15, geminiBlockOff 16, deepSeekPrefix 17, deepSeekThinkingInput 18, deepSeekThinkingOutput 19, noCivilIntegrity 20, claudeThinking 21, claudeAdaptiveThinking 22, claudeXHighEffort 23, deepSeekThinkingToggle 24 (`BS:763-786`). 24 buttons. Flag 11 is skipped (INFERRED: unused or removed). Effects on parameters: claudeThinking, claudeAdaptiveThinking, claudeXHighEffort and deepSeekThinkingToggle gate controls in section PARAMS (`PARAMS:138-139,155,186,193,205`), so a custom flag can reveal Parameters rows.

## 6. Per-task parameters

| Fact | Anchor |
|---|---|
| Master switch `db.seperateParametersEnabled` (default false). Rendered as a checkbox in an accordion "Separate Parameters"; four sub-blocks show only when on, one `AllSeperateParameters` per key of `db.seperateParameters`. | `DB:589`; `SeparateParametersSection.svelte:16-21` |
| Storage `db.seperateParameters = {memory, emotion, translate, otherAx, overrides: Record<modelId, SeparateParameters>}`. Each task object starts `{}` (all fields undefined). `seperateParametersByModel` (db, optional) switches to per-model-id overrides (EasyPanel only: `EasyPanel.svelte:109-147`; no UI in BotSettings). | `DB:589-597,1152-1159,1312` |
| Per-task fields (`SeparateParameters`): temperature, top_k, repetition_penalty, min_p, top_a, top_p, frequency_penalty, presence_penalty, reasoning_effort, thinking_tokens, thinking_type, deepseek_thinking_type, adaptive_thinking_effort, deepseek_reasoning_effort, verbosity, plus `outputImageModal` (not shown in this component). No max context/response, no seed, no bias/additionalParams per task. | `DB:1337-1354` |
| Per-task UI: labels `language.temperature` (+ Help "tempature"), then literals "Top K", "Repetition Penalty", "Min P", "Top A", "Top P", `language.frequencyPenalty`, `language.presensePenalty`, `ClaudeThinkingSeparateParams`, "Reasoning Effort", "Verbosity". Temperature and reasoning/verbosity only render when the task's effective model supports them; the other seven sliders render unconditionally (not gated by model `parameters`). All sliders `disableable`. Frequency/presence sliders use `max=200 step=0.01 fixed=2` with no `multiple`, unlike the main page (x0.01 of 0-200), so the displayed number is the raw 0-200 stored value, though the request divides by 100 (`SHARED:239,246`). INFERRED unit inconsistency; `AllSeperateParameters.svelte:86-89`. | `AllSeperateParameters.svelte:72-98` |
| The task block's model: for keys memory/emotion/translate/otherAx, the effective model is `seperateModels[key]` when `seperateModelsForAxModels` is on, else `subModel`. The temperature/reasoning controls follow that. | `AllSeperateParameters.svelte:27-37` |
| Read in request code: in `applyParameters`, if `seperateParametersEnabled` AND (the call is not the main model OR `seperateParametersByModel`) the task block is used instead of the live db values entirely (not merged). `submodel` mode always uses `seperateParameters.otherAx`. With `seperateParametersByModel`, `overrides[modelId]` is used and a missing entry throws `errors.separateParamsMissing`. Unset fields in a task block are skipped (undefined), so provider defaults apply; they do NOT fall back to the main preset values. OBSERVED. | `SHARED:181-195,264-273` |
| `modelMode` values: 'model' \| 'submodel' \| 'memory' \| 'emotion' \| 'otherAx' \| 'translate'. | `SHARED:22` |
| Preset behavior: the enabled flag and the object are per-preset; `disableSeperateParameterChangeOnPresetChange` (Advanced, hidden) keeps the live object across preset switches (`DB:2289,2322-2333`). | `DB:2152-2153,2289,2322-2333` |
| Retiring the global checkbox (DS-082) while keeping same behavior needs a per-task "same as main" flag; today "same as main" for a task is implemented as: global flag off for all four at once. Two states per task do not exist. INFERRED. | - |
| Missing main-model rows in the shared UI: tasks cannot set max response. The translator presets have their own `maxResponse` (`translator/presets.ts:10,74`), a separate system (Language page). | `presets.ts:10` |

## 7. Existing help text

Help UI: `Help key="..."` renders `language.help.<key>` (today-settings §7). In `PARAMS` only `helpKey: 'tempature'` is used (`PARAMS:62`). In `AllSeperateParameters` only temperature has a Help (`:73`). Accordion `help=` props on the Others tab: `bias`, `additionalParams`, `moduleIntergration` (`BS:638,694,791`).

| Help key (`language.help.*`) | English text (brief) | ko exists | Anchor |
|---|---|---|---|
| `tempature` (typo) | lower = follows prompts closely but machine-like; higher = creative but can break down | yes, 값이 낮을수록 ... (`ko.ts:483`) | `en.ts:488-489` |
| `bias` | key-value data that changes likelihood of a string; -100..100; -101 = strong ban for some models; wrong tokenizer breaks it | yes (`ko.ts:494`) | `en.ts:500` |
| `additionalParams` | extra request body params; `{{none}}`, `header::`, `json::` rules | yes (`ko.ts:531`) | `en.ts:584-585` |
| `moduleIntergration` | comma-separated module namespaces; for advanced users varying modules per preset | yes (`ko.ts:553`) | `en.ts:621-622` |

Label keys (not help) available: `maxContextSize` "Max Context Size" / "최대 컨텍스트 크기"; `maxResponseSize` "Max Response Size" / "최대 응답 크기"; `temperature` ko "온도" (`ko.ts:1025`); `seed`; `frequencyPenalty`; `presensePenalty`; `thinkingTokens` "사고 토큰"; `thinkingType` "사고 모드" (`ko.ts:1739-1740`); `disabled` ko "비활성화됨"; `noBias`; `customFlags`/`enableCustomFlags`; `tools`; `additionalParams`; `moduleIntergration` (`ko.ts:1015,1024,1095,1448,1563,1617`). No help key at all for: max context/response, seed, top P/K, min P, top A, repetition/frequency/presence penalty, reasoning effort, verbosity, thinking*, adaptive effort, DeepSeek, custom flags, tools, and every Ooba/NovelAI/NovelList slider. `top_k`, `min_p`, `top_a`, `top_p`, `repetitionPenalty`, `reasoningEffort`, `verbosity` labels are English literals via `fallbackLabel` (`PARAMS:114,218,232,247,262,277,299`). The six DS-081 elements (plain sentence, low/high hint, default, longer help) are all new copy except the temperature text.

## Not read / limits

- Not run; no UI observed. Runtime behavior (e.g. SliderInput after switching models) is INFERRED from code.
- Not read in full: `ClaudeThinkingSeparateParams.svelte`, `SettingRenderer.svelte` and the Slider/Segmented wrappers (the `-1000` and `actualMax` behavior comes from `SliderInput.svelte` and `SettingNumber.svelte` only; whether `SettingSlider` wraps `SliderInput` unchanged was not opened, the file named `SettingSlider.svelte` was not found at `src/lib/UI/GUI/`).
- Not traced: individual provider request builders beyond the `applyParameters` call sites; `request.ts:504` use of `arg.temperature`; the LiteLLM/OpenRouter dataset parser internals (only `chooseContextLimit`'s signature, and that no `maxOutput` consumer exists by grep); `OobaSettings.svelte`/`OpenrouterSettings.svelte` fields; every `prebuiltPresets` entry (NAI, OAI, OAI2 values only for the fields above).
- Full per-field `presetFromWorkingSettings`/`setPreset` coverage for `enableCustomFlags`, `localStopStrings`, `additionalParams` not confirmed field by field.
- Locale: only en and ko checked; other five locales not opened.
- Not read: signing material, env secrets, `Agents/Evidences of Investigations/`.
