# Slice 5b source discovery: 대화 기능 (memory, voice, emotion images, image generation, translation)

Date 2026-10-28. Source read only (`src/`), nothing run. "OBSERVED" = read in code; "INFERRED" = my reading, not executed. Anchors are `file:line`. Proposals are kept in section 9 only.
Abbreviations: OBS = `src/lib/Setting/Pages/OtherBotSettings.svelte`; DB = `src/ts/storage/database.svelte.ts`; LSD = `src/ts/setting/languageSettingsData.svelte.ts`; CC = `src/lib/SideBars/CharConfig.svelte`; IDX = `src/ts/process/index.svelte.ts`.

## 0. Headline facts that shape the design
1. OBSERVED: the four tabs of OBS (memory, TTS, emotion, image) do NOT hold translation. Translation lives on the 언어 page (LSD, 367 lines). Slice 1 data.js already moved it to chatfeat and left a pointer note `lang.restartNote` (data.js:303).
2. OBSERVED: the TTS tab in OBS holds only keys/URL plus one global auto-play check (OBS:975-998). Voice choice, speed scale, "read only quoted" and every engine detail are per character in CC (CC:750-1053), which is Studio territory.
3. OBSERVED: image-generation prompt, negative prompt and the prompt-writer instructions are per character (`character.newGenData {prompt, negative, instructions, emotionInstructions}`, DB:1409-1414; CC:545-569). There is no global prompt prefix, negative prompt or auto-generate toggle. Slice 1 rows `imgPositive`, `imgNegative`, `imgAuto`, `imgSeed`, `imgStrength`, `imgRefChar`, `ttsSpeed`, `ttsSplit`, `ttsSkipCode`, `emoShow`, `emoSize`, `emoCache`, `emoDefault`, `emoPrompt` (as a global 감정 프롬프트 in this page) are catalog inventions or relocations with no matching global db field of that kind (see section 8 table).
4. OBSERVED: per-character `viewScreen` ('emotion' | 'imggen' | other) decides whether emotion images or image generation runs at all for that character (IDX:2592, 2772; CC:470-560).
5. OBSERVED: the memory type is not one field. It is four booleans/strings (`hypaV3`, `hypav2`, `supaModelType`, `hanuraiEnable`) plus `memoryAlgorithmType`; the select derives its value from them and writes all five (OBS:1015-1054).

## 1. Long-term memory

### 1.1 Engines (OBS:1015-1060; gate in IDX:1528)
Memory only runs for a chat room when `nowChatroom.supaMemory` is on AND one engine flag is set (IDX:1528). That per-chat toggle ("Toggle SupaMemory/HypaMemory", en.ts:1320,1483) is chat-level, not in Settings.
| Engine (UI label) | One plain sentence | Source of sentence |
|---|---|---|
| None | Memory off; old messages just fall out of context. | INFERRED |
| SupaMemory (`supaModelType !== 'none'`, not hypav2/v3) | Summarises old messages into one block that is sent to the AI. | `supaDesc` en.ts:1631 |
| HypaMemory V2 (`hypav2`) | Summaries plus vector search. | `hypaV2Desc` en.ts:1630 |
| HanuraiMemory (`hanuraiEnable`) | Vector search only; no summaries. | `hanuraiDesc` en.ts:1632 |
| HypaMemory V3 (`hypaV3`) | Summaries plus vector search, with presets and a memory-share budget. | `hypaV3Settings.descriptionLabel` en.ts:1782 |
Default for new databases: `supaModelType` "none" (DB:254), `hanuraiEnable` false (DB:535); `hypaV3` default not read (INFERRED false). Slice 1 default `hypav3` is a mockup choice.

### 1.2 Settings per engine (storage: all global `db`; no per-character memory settings except the chat toggle)
| Engine | Field | Control | Default | Range | db field (anchor) |
|---|---|---|---|---|---|
| Hanurai | chunk size | number | 1000 (DB:537) | min 100 | `hanuraiTokens` OBS:1065 |
| Hanurai | text splitting | check | false | - | `hanuraiSplit` OBS:1067 |
| Supa | summary model | select distilbart / instruct35 / subModel | "distilbart" once chosen (OBS:1024) | - | `supaModelType` OBS:1273 |
| Supa | max chunk size | number | 1200 (DB:475) | min 100 | `maxSupaChunkSize` OBS:1279 |
| Supa | OpenAI key (only for instruct35/davinci/curie) | text | "" | - | `supaMemoryKey` OBS:1282 (a SEPARATE key from `openAIKey`; third OpenAI-type key) |
| Supa | summary prompt | single-line text | "" blank=default | - | `supaMemoryPrompt` OBS:1286 |
| Supa | "Enable HypaMemory" | check | - | - | `hypaMemory` OBS:1289 (adds vector search to Supa) |
| HypaV2 | summary model, key, prompt | as Supa; prompt is a textarea | | | `supaModelType`, `supaMemoryKey`, `supaMemoryPrompt` OBS:1072-1082 |
| HypaV2 | chunk size | number | 3000 (DB:546) | min 100 | `hypaChunkSize` |
| HypaV2 | allocated tokens | number | 3000 (DB:545) | min 100 | `hypaAllocatedTokens` |
| All vector engines | embedding model | select | "MiniLM" (DB:408) | 17 values (1.4) | `hypaModel` OBS:1294 |
| Embedding openai* / ada | OpenAI key | text | "" | | `supaMemoryKey` OBS:1318 (same field as Supa key) |
| Embedding custom | URL, key, model name | 3 text | "" | | `hypaCustomSettings.{url,key,model}` OBS:1323-1327 |
| Embedding voyageContext3 | Voyage key | text (masked by hideApiKey) | "" | | `voyageApiKey` OBS:1332 |
Note: `hypaMemoryKey` exists in DB (DB:248,944) but is not shown here (OBSERVED by absence in OBS).

### 1.3 HypaV3 preset model
- Preset = `{name, settings: HypaV3Settings}` (hypav3.ts:30-51; `createHypaV3Preset` hypav3.ts:1804-1848). Stored `db.hypaV3Presets[]`; active one is the INDEX `db.hypaV3PresetId` (DB:1179-1180), so deleting/inserting shifts identity. The code drops unknown or wrong-typed keys when building a preset (hypav3.ts:1837-1841) and re-normalises all presets on every load (DB:613-620). `db.hypaV3Settings` is a legacy field only used to seed "Default" (DB:607-612).
- Presets are global, not per character or per chat. Preset switching changes the active engine settings immediately (no "apply" step).
- Operations (OBS:1089-1186), all unlabeled lucide icon buttons (no text, no tooltip seen): select (native `<select>`), create (+): new preset named "New Preset" with defaults, selected, no name prompt (OBS:1099-1108); rename (pencil): prompt dialog (1110-1128); delete (trash): blocked when only one preset, confirm text is `removeConfirm + name`, then active id resets to 0 (1130-1153); export (download): JSON `{type:'risu', ver:1, data:preset}` named `hypaV3_export_<name>.json` (1157-1181); import (upload icon): `hypaV3PresetImport.ts:13-38`, adds and selects; a non-risu file is silently ignored, bad JSON shows error. **No copy/duplicate exists** (user asked about copy; OBSERVED absent).
- Settings fields and defaults (hypav3.ts:1808-1830; UI OBS:1191-1265):
| Field | Control / range in UI | Default |
|---|---|---|
| `summarizationModel` | select: "subModel" or 3 WebLLM GPU models (only if `"gpu" in navigator`) | subModel |
| `summarizationPrompt`, `reSummarizationPrompt` | textarea, blank = default | "" |
| max memory ratio | read-only number, computed from context (see 1.5) | - |
| `memoryTokensRatio` | slider 0-1 step .01 | 0.2 |
| `extraSummarizationRatio` | slider 0 to (1 - memoryTokensRatio) | 0 |
| `maxChatsPerSummary` | number min 1 | 6 |
| `queryChatCount` | number 1-20 | 3 |
| `summaryChunkSeparator` | text | `"\\n\\n"` (literal backslash-n) |
| `recentMemoryRatio`, `similarMemoryRatio` | sliders 0-1; an $effect forces their sum <= 1 (OBS:34-66) | 0.4 / 0.4 |
| random ratio | read-only = 1 - recent - similar | 0.2 |
| `preserveOrphanedMemory`, `processRegexScript`, `doNotSummarizeUserMessage` | checks | false |
| Advanced: `useExperimentalImpl` | check | false |
| Advanced: `alwaysToggleOn` | check ("auto-activate the HypaMemory toggle when selecting a character", en.ts:720; applied in stores.svelte.ts:198) | false |
| Advanced, experimental on: `summarizationRequestsPerMinute` / `...MaxConcurrent` / `embeddingRequestsPerMinute` / `embeddingMaxConcurrent` | numbers min 1 (concurrency 1-10) | 20 / 1 / 100 / 1 |
| Advanced, experimental off: `enableSimilarityCorrection` | check | false |
- OBSERVED defect: the ratio $effects use `if(!currentValue) return`, so a ratio of 0 is never clamped (OBS:38,55). Minor.

### 1.4 Embedding model list (OBS:1294-1314)
CPU: MiniLM L6 v2, Nomic Embed Text v1.5, BGE Small English, BGE Medium 3, Multilingual MiniLM L12 v2, BGE Medium 3 Korean; same six as GPU variants shown only if `"gpu" in navigator`; hosted: OpenAI text-embedding-3-small/-large, Ada, Voyage Context 3; Custom (OpenAI compatible). Raw enum values are the stored ids. The embedding choice is shared by other features (additional text, dynamic assets, trigger scripts, file attachments, playground, and emotion method "embedding") per help `embedding` en.ts:685-692, yet it only appears under 장기 기억 here. Emotion-by-embedding builds `new HypaProcesser()` with the same `db.hypaModel` (IDX:2609; hypamemory.ts:54).

### 1.5 Link to the memory model (DS-044/DS-051)
- OBSERVED: HypaV3 with `summarizationModel === 'subModel'` calls `requestChatData(..., 'memory')` (hypav3.ts:1726-1737), so the per-task "memory" model from the 모델 page applies (Supa `supaMemory.ts:284-290` and HypaV2 `hypav2.ts:143-149` also use mode `'memory'`). The log string says "Using ax model ${db.subModel}" (hypav3.ts:1727) but the mode is 'memory'; whether an unset memory model falls to main or sub is decided in `requestChatData` (not read here; DS-051 says main).
- OBSERVED: the select option reads "subModel" (`language.submodel`), which is misleading once the user sets a separate memory model (INFERRED: the label should say "per-task memory model").
- OBSERVED: the Supa/HypaV2 select also offers "subModel". Local choices (distilbart; WebLLM Qwen3 1.7B/4B/8B) bypass any model setting and unload the engine after use (hypav3.ts:171-176).
- Max memory ratio is computed from prompt template tokens, character tokens, lorebook budget, 3x max response and max context (OBS:68-84): the page needs a selected character and reads `$selectedCharID`; with none selected it throws and the page shows `maxMemoryTokensRatioError` (OBS:1211-1213). INFERRED: design cannot show a true value without a character; use a stand-in or hide.

### 1.6 Warnings and costs
- Summarising engines make extra model requests (Supa/HypaV2/V3 summarise via the memory model; V3 experimental has per-minute limits). No cost text exists in OBS (OBSERVED by absence).
- Local models (distilbart, WebLLM Qwen3, CPU/GPU embeddings) download on first use; no size or "will download" notice anywhere in OBS (OBSERVED by absence; the download itself is INFERRED from the transformers/webllm use).
- Changing the embedding model on a chat that already has memory: no warning; whether stored vectors are invalidated was not read (open point).

## 2. Voice (TTS)

### 2.1 Global in Settings today (OBS:975-998, 6 inputs, all plain text with no hiding except none)
| UI label | db field | Used by engine |
|---|---|---|
| auto speech (check) | `ttsAutoSpeech` (DB:916,567 default false) | all |
| ElevenLabs API key | `elevenLabKey` | elevenlab tts.ts:224; voice list CC:791 |
| VOICEVOX URL | `voicevoxUrl` | VOICEVOX tts.ts:263,288; speakers list tts.ts:684 |
| OpenAI key | `openAIKey` (same as chat OpenAI key and Dall-E key) | openai tts.ts:310 |
| NovelAI API key | `NAIApiKey` (same field as NovelAI image key, OBS:322) | novelai tts.ts:379 |
| Huggingface key | `huggingfaceKey` | huggingface tts.ts:410 |
| fish-speech API key | `fishSpeechKey` | fishspeech tts.ts:590; model list tts.ts:664 |
Keys can be `${NAME}` references (`resolveSecret`). The TTS text inputs do not use `hideText={hideApiKey}` while image-tab keys partly do (OBS:778,818,843 vs 980-995).

### 2.2 Engines and where each field lives (switch tts.ts:201-609; picker CC:756-771)
Engine ids: webspeech, elevenlab, VOICEVOX, openai, novelai, huggingface, vits, gptsovits, fishspeech (+ "" disabled). Mode is per character (`ttsMode`).
| Engine | Global (Settings) | Per character (CC, Studio) |
|---|---|---|
| webspeech | none | voice name `ttsSpeech` ("" = auto) |
| elevenlab | key; model fixed `eleven_multilingual_v2` (tts.ts:228) | voice id `ttsSpeech` (list fetched live with the key) |
| VOICEVOX | URL | speaker (JSON string of styles) `voicevoxConfig.speaker`, style id `ttsSpeech`, SPEED/PITCH/VOLUME/INTONATION_SCALE (defaults 1/0/1/1, plain number inputs) |
| openai | key (fallback) | voice `oaiVoice`; optional "advanced endpoint" `oaiTTSConfig {enabled, baseURL, apiKey, model(tts-1), voice, format(mp3)}`; a per-character key overrides global (tts.ts:310); `${NAME}` global key only allowed to api.openai.com (tts.ts:314-318) |
| novelai | key | `naittsConfig {customvoice, voice(Aini), version(v2)}` |
| huggingface | key | `hfTTS {model, language}`; non-English language triggers the translator (tts.ts:402-407); waits/retries a 503 up to 5 requests / 30 s (tts.ts:58-59) |
| vits | none | ONNX model file `vits` |
| gptsovits | none | `gptSoVitsConfig {url, use_auto_path, ref_audio_path, use_long_audio, ref_audio_data, volume, text_lang, use_prompt, prompt, prompt_lang, top_p, temperature, speed(0.6-1.65), top_k, text_split_method cut0-5}` (CC:919-1021) |
| fishspeech | key | model `fishSpeechConfig.model._id` (list fetched from the account), chunk_length 200, normalize false; API host fixed `api.fish.audio` |
- Always per character, any engine: `ttsReadOnlyQuoted` (CC:1050): speak only text inside quotes; `filterTTSText` also strips `*` (tts.ts:84-97).
- OBSERVED: VOICEVOX text is machine-translated to Japanese before synthesis (tts.ts:259, `translateVox` -> runTranslator), so VOICEVOX depends on the translator (it runs even when 번역 is "disabled"; INFERRED since runTranslator reads `translatorType`).
- Slice 1 voice rows `elevenVoice`, `openaiVoice`, `voicevoxSpeaker` model per-character values as global; they are design proposals, not today's behaviour.

### 2.3 Auto-play, speed, splitting, skipping
- Auto-play: one global `ttsAutoSpeech`; after a reply finishes it speaks only if the current character has a voice mode (`isTTSVoiceMode`), IDX:2472-2488. `ttsAddition` speaks only the newly appended part of a streamed reply (ttsAddition.ts:31); there is a speaker button on messages (Chat.svelte:1146) and a toggleVoice hotkey (today-settings §6) - not re-verified.
- No global speed, no sentence splitting setting, no "skip code blocks" setting exist (grep of tts*.ts: only GPT-SoVITS `text_split_method`, VOICEVOX speed scale, GPT-SoVITS speed). Slice 1 rows `ttsSpeed/ttsSplit/ttsSkipCode` have no source. Closest real behaviour: asterisks are always stripped; quote-only is per character.
- Hook pre/post processors from plugins can skip or change audio (tts.ts:186-193, 110-148).
- Test or preview: none in Settings. The only test path is the message speaker button or chat auto-play; errors appear as `ttsError` alerts. Voice lists are fetched on render inside `{#await}` in CC with no refresh button.

## 3. Emotion images
- OBS UI is one select (OBS:1004-1007): "submodel" (`optAxModel`, "Ax. Model") or "embedding" labelled "MiniLM-L6-v2". Stored `db.emotionProcesser` default 'submodel' (DB:410). The label says MiniLM but embedding actually uses the shared `hypaModel` (IDX:2609 uses `new HypaProcesser()` with default model = `db.hypaModel`, hypamemory.ts:54). INFERRED mislabel.
- Method sub model: sends a chat request with mode `'emotion'` (IDX:2703-2709) - the per-task emotion model (DS-044/051: sub model when unset). Max 30 tokens, token logit bias toward the emotion words (+10) and against the last 5 used (IDX:2661-2682). Embedding: similarity search over `emotion:<name>` with a recency penalty (IDX:2616-2630); no model call.
- Prompt: `db.emotionPrompt2` (blank = built-in English default, IDX:2687), edited on the ADVANCED page (`adv.emoPrompt`, advancedSettingsData.ts:35, help `emotionPrompt`), not here. There is also a per-character `newGenData.emotionInstructions` (CC:545) used in a different path (IDX:1013). Whether both are live was not resolved.
- Per character (Studio): `emotionImages [name, assetId][]`, `viewScreen='emotion'`, `inlayViewScreen`. Fallback when the model returns a word not in the list: 'neutral' if present (IDX:2755). Only the last 5 emotions are remembered per chat session (IDX:2604).
- Related global elsewhere: `useChatSticker` on Display page (displaySettingsData.svelte.ts:355).
- Slice 1 rows `emoMethod` ("none/classify/llm"), `emoShow`, `emoSize`, `emoCache`, `emoDefault`: no such db fields found; real options are only submodel and embedding, and "none" = character not set to emotion screen.

## 4. Image generation

### 4.1 Provider list (select OBS:266-282; dispatch stableDiff.ts:95-971)
Values: "" (none), webui, novelai, dalle, stability, fal, comfyui, Imagen, openai-compat, wavespeed, plus legacy "comfy" (shown only if already selected, OBS:279) and an internal 'kei' that errors out (stableDiff.ts:37, 627). Default '' (DB:185). Not-set error `stableDiffusionNotSet` when generating (stableDiff.ts:32-35).
| Provider | Fields (db) | Key / address field |
|---|---|---|
| webui | URL `webUiUrl`; steps `sdSteps` 0-100; CFG `sdCFG` 0-20; width/height `sdConfig.width/height` 0-2048; sampler text `sdConfig.sampler_name`; Hires check `sdConfig.enable_hr` -> `denoising_strength` 0-10, `hr_scale` 0-10, `hr_upscaler` text. Notices: needs `--api` flag, AGPL notice, tunnel notice if not Tauri (OBS:285-289). Seed fixed -1 (stableDiff.ts:105) | URL |
| novelai | URL `NAIImgUrl`; key `NAIApiKey` (shared with NAI TTS and chat); model `NAIImgModel` (9 ids); width/height `NAIImgConfig`; sampler (list varies by model); noise_schedule (native/karras/exponential/polyexponential); steps; scale; cfg_rescale 0-1; reference mode none/vibe/character (vibe: .naiv4vibe upload, vibe model, information extracted, strength; character: image upload, Style Aware); checks SMEA, DYN, Variety+, Decrisp, legacy uc (each only for some models); I2I check -> base image, strength, noise | URL + key |
| dalle | `openAIKey` (shared), `dallEQuality` standard/hd | key |
| stability | `stabilityKey`, `stabilityModel` ultra/core/sd3-large/sd3-medium, core-only style `stabllityStyle` (16 options) | key |
| fal | `falToken`; width/height (shares `sdConfig`); `falModel` (4 Flux ids); LoRA URL `falLora` + weight `falLoraScale` 0-2 (only flux-lora) | key |
| comfyui | URL `comfyUiUrl`; workflow `comfyConfig.workflow` (a text field, help `comfyWorkflow`); timeout `comfyConfig.timeout` 1-120 s (OBS:715-724) | URL |
| comfy (legacy) | + positive/negative node id and field name (4 inputs), notices (first image slow, CORS) | URL |
| Imagen | key `google.accessToken` (shared with chat Google key); model (4); image size 1K/2K (4.0 and ultra only); aspect ratio (5); person generation allow_all/allow_adult/dont_allow | key |
| openai-compat | URL `openaiCompatImage.url`; key; model text; size (5); quality auto/low/medium/high | URL + key |
| wavespeed | key `wavespeedImage.key`; model chosen from a LIVE-FETCHED list (refresh button, search box, labels with price and support ticks); up to 3 LoRA URL+scale rows if model supports; reference none/image/character if model supports image input | key |
Fal/WebUI share `sdConfig.width/height`; NAI has its own. There is no single "size" field.

### 4.2 Shared settings
- Prompt prefix, negative, writer instructions: per character `newGenData` (CC:545-569). No global prefix. `{{slot}}` is replaced by the sub-model-written image prompt (stableDiff.ts:81). Playground and triggers call `generateAIImage` with their own prompt/negative.
- Pipeline when `viewScreen==='imggen'` (IDX:2772-2794): requires non-group chat; builds last user/char messages; asks the sub model (mode `'submodel'`, stableDiff.ts:66) for a prompt (temperature .2, 300 tokens), then calls the provider. So each generated image costs one sub-model request plus the image request. No global auto toggle or seed.

### 4.3 Test path
None in Settings. Closest: `PlaygroundImageGen.svelte` (src/lib/Playground, calls `generateAIImage` with a blank character). WaveSpeed model refresh is the only "check" and it validates the key (alert `wavespeedKeyMissing` if empty, OBS:113-116).

### 4.4 Most representative for the pattern (my read, not decision)
1. OpenAI-compatible (URL + key + model + size + quality): simplest "address + key + model".
2. Stable Diffusion WebUI: local, address, many numeric/sampler fields, Hires sub-group; fits "many parameters".
3. ComfyUI (address + workflow + timeout) or WaveSpeed (live model list + conditional LoRA/reference); WaveSpeed shows the "fetch models" pattern and the key reference, ComfyUI is simpler. NovelAI is the most field-heavy and best left list-only (DS-128).

### 4.5 Keys and addresses (DS-011/013)
NAI key duplicated across chat, image, TTS; OpenAI key across chat, Dall-E, TTS (and a 3rd `supaMemoryKey` for Supa/embeddings); Google key shared with Imagen. Image URLs: `webUiUrl`, `NAIImgUrl`, `comfyUiUrl`, `openaiCompatImage.url`. All currently live in this page.

## 5. Translation
### 5.1 Fields (LSD:90-366; stored in db)
| UI | Control | db field | Default | Shown when |
|---|---|---|---|---|
| translator language | select: disabled, ko, ru, zh, zh-TW*, fa*, ja, fr, es, pt, de, id, ms, uk (*google only) | `translator` | "" (off) | always |
| type | select Google / DeepL / "Ax. Model" / DeepL X / "Firefox" | `translatorType` | 'google' (DB:411) | language set |
| DeepL key, free-key check | text, check | `deeplOptions.key/freeApi` | "", false | deepl; warning `webdeeplwarn` on web |
| DeepLX URL, token | text, text | `deeplXOptions.url/token` | "", "" (URL falls back to http://localhost:1188 in code, translator.ts:181) | deeplX |
| LLM presets | custom component | see 5.2 | | llm |
| source language | select auto,en,zh,ja,ko,fr,es,de,ru | `translatorInputLanguage` | 'auto' (DB:568) | google only |
| HTML translation | check | `htmlTranslation` | false | bergamot ("Firefox") |
| auto translation | check | `autoTranslate` | false | language set |
| combine translation, legacy translation | checks with help | `combineTranslation`, `legacyTranslation` | false | language set |
| translate before HTML formatting | check | `translateBeforeHTMLFormatting` | false | llm |
| auto-translate cached only | check | `autoTranslateCachedOnly` | false | llm |
| export / import / clear cache | 3 buttons | LLM cache in storage (translator.ts:619-668) | | llm only |
Not on the page but real: `useExperimentalGoogleTranslator`, `noWaitForTranslate` (translator.ts:173,222) - found in code, UI location not checked. Bergamot runs a local model (INFERRED, `bergamotTranslator` dynamically imported, translator.ts:215). Google uses the unofficial public endpoint (translator.ts:249).
Cost: llm type spends model requests per message (INFERRED); `isExpTranslator` marks llm/deepl/deeplX as external-per-request (translator.ts:286-289). DeepL/DeepLX/llm translations show per-message retranslate; the cache is LLM-only.

### 5.2 LLM translator presets (`Language/TranslatorPresetSettings.svelte`)
- Model: `{name, prompt, maxResponse}` (presets.ts:7-11), stored `db.translatorPresets[]` + index `db.translatorPresetId`; the current preset is mirrored into legacy `translatorPrompt/translatorMaxResponse` (presets.ts:133-146). Default prompt `defaultTranslatorPrompt` with `{{slot}}` = target language (presets.ts:26). Default maxResponse 1000 (presets.ts:99-101).
- Ops: select (native select), new (+, "New Preset", no name prompt), rename (prompt), delete (confirm, blocked at 1), export `.risutl` (obfuscated with a fixed key "risutl", presets.ts:30,223-232), import. No duplicate. maxResponse number 0-2048; prompt textarea with the default as placeholder. Icons-only buttons again.
- Which model translates: per-task translation model (DS-044), data.js `chatfeat.transModelLink`.

### 5.3 Per chat / per message
- OBSERVED: the translated view is local component state `translated = $state(false)` in `Chat.svelte:105` (toggle at :413, translate button :1168); it is not saved. `useAutoTranslateInput` (translate what you type) is a db flag toggled from the chat input menu (DefaultChatScreen.svelte:1044-1048), not in Settings. Auto-translate reads `autoTranslate` and `autoTranslateCachedOnly` per message (ChatBody.svelte:86-87).
- Hotkey `translate` exists (today-settings §6).

### 5.4 Slice 1 vs this page
Slice 1 puts a pointer on the 언어 page (data.js:303) and full rows in chatfeat (data.js:200-216, 443-446). Slice 1 invented `trLang` ko/en/ja/zh, `trSource` auto/en/ja for all types (real: source only for Google), `trDeeplKey/trDeeplxToken` as keys here (DS-011 says refs in 연결: data.js:443-445), `trHtml` (real: bergamot only) and shows cache buttons for every type (real: llm only). `trType` there says "Bergamot"; UI today says "Firefox".

## 6. Synthetic-data needs (realistic, not secrets)
- Memory: preset names "기본", "빠른 요약", "긴 이야기용"; summary prompt text; ratios 0.20/0.40/0.40; one preset with `useExperimentalImpl` on (rate limits 20/1/100/1); embedding "Multilingual MiniLM L12 v2 (CPU)"; Supa instruct35 as "needs key" state.
- Voice: ElevenLabs key as `${ELEVEN_KEY}` reference, VOICEVOX `http://voicevox.invalid:50021`, Fish key empty (missing state), OpenAI key shared with chat; two characters with different engines to show per-character reality.
- Emotion: sub model name, 8 emotion names (happy, sad, angry, surprised, neutral, shy, smile, worried).
- Image: WebUI `http://webui.invalid:7860`, sampler "Euler a", 832x1216, steps 28, CFG 7; ComfyUI `http://comfy.invalid:8188` timeout 60; WaveSpeed model list of 5 with prices (e.g. 0.003-0.04 USD) and two tick columns; NAI model ids as in 4.1.
- Translation: DeepLX `http://deeplx.invalid:1188`, 3 LLM presets ("기본", "존댓말 유지", "웹소설체") with prompts containing `{{slot}}`, cache count ~1,284 entries, language ko.
- Failure states: missing key, unreachable local URL, model list fetch failed, 503 warm-up (HF), timeout (Comfy).

## 7. Pain points visible in code
- Raw enum labels / English: "Ax. Model", "Firefox" for bergamot, "Sampler" free text instead of a list for WebUI, "Steps", "CFG Scale", "denoising_strength", "hr_scale", "Noise Schedule", "Information Extracted", "Reference Strength Multiple", "Style Aware", "Use DYN", "Decrisp", "Variety+", "Speed scale" etc. are literals (OBS:292-314, 368-381, 469-505, 569-597; CC:819-829). Emotion option "MiniLM-L6-v2" misnames the method.
- Duplicated or shared keys: OpenAI key x4 uses (chat, Dall-E, TTS, plus separate `supaMemoryKey`); NAI key x3; Google key; keys are plain text on the TTS tab (no hide).
- Legacy-GUI stacking: with `useLegacyGUI` all four sections stack on one page (OBS:31, 238, 263-1336); image block alone ~700 lines.
- Four-way memory flag derivation (OBS:1015-1054) can disagree if data is imported partially (INFERRED).
- Preset UI: icon-only buttons with no label (OBS:1099-1183), index-based active preset, no duplicate, silent ignore of foreign import file (hypaV3PresetImport.ts:22).
- Mobile: HypaV3 button row and wide selects not checked on narrow screens; WaveSpeed model options hold a long label with price+ticks inside a native select (OBS:198-207). INFERRED risk.
- Missing confirmations: switching memory engine silently rewrites five fields (OBS:1020-1053); removing an image reference only has a red "Delete" with no confirm; clear translation cache does confirm (LSD:355), import cache confirms (LSD:322); preset delete confirms.
- Misplaced settings: emotion prompt on Advanced; image prompts/negatives only in the character editor; VOICEVOX speaker only in the character editor; TTS test absent.
- Misleading labels: "subModel" for summarisation (really the memory task model); Max Memory Ratio read-only number needs a character.
- Hidden dependencies: VOICEVOX and HF-TTS (non-English) need the translator (tts.ts:259, 402-407); emotion-embedding and memory share `hypaModel`.
- Costs invisible: summarisation requests, sub-model prompt per generated image, WaveSpeed price, model downloads.

## 8. Slice 1 catalog vs source (chatfeat rows, data.js:142-216)
| Slice 1 row | Real source |
|---|---|
| memType, memPreset (default/fast/deep), memRatio, memChunk, memRecent, memEmbed (3 values), memSim, memAuto, memPrompt | memType real (5 values). Presets in real life are user-named and per-user. `memRatio`, `memRecent`, `memSim`, `memAuto` have no matching global field; memChunk ~ `maxSupaChunkSize`/`hypaChunkSize`/`hanuraiTokens`; memEmbed has 17 real values |
| memRemovePunct (`removePunctuationHypa`), memLimit/memLimitThickness (`showMemoryLimit`, `memoryLimitThickness`) | not read in OBS; grep needed (listed as syn only) |
| ttsEngine incl. 'vits','fish','browser' | engines are per character; global part is keys/URL/auto only |
| emo*, img* extras | see sections 3, 4 |
| trLang/trType/trSource | see 5.4 |
| `chatfeat.refNai/refWave/refOpenaiImg/refEleven/refOpenaiTts/refDeepl/refDeeplx` | consistent with DS-011/013; missing refs for Stability, Fal, Google (Imagen), HuggingFace, Fish, Voyage, OpenAI-compat image, WebUI/ComfyUI/VOICEVOX/NAI URLs (DS-013 says addresses also move) |

## 9. Open product questions (for the maintainer; options, not decisions)
1. Per-character vs global voice: Studio keeps voice choice; Settings should hold only keys/address/auto-play (matches today). Options: (a) keep the split and link both ways; (b) add a global default engine and voice per character override; (c) move voice choice into Settings with a per-character picker.
2. Image prompt prefix/negative: today per character. Options: (a) keep in Studio and show read-only here; (b) add a new global default used when a character has none (new db field); (c) drop from this page.
3. Slice 1 invented rows without source (ttsSpeed/Split/SkipCode, emoShow/Size/Cache/Default, imgAuto/Seed/Strength/RefChar, memRatio/Recent/Sim/Auto, trLang list): remove, keep as clearly-new proposals, or map to nearest real field.
4. Emotion methods: only submodel and embedding exist. Options: (a) show these two with plain names and the shared embedding model; (b) also show a "none" via per-character screen; (c) fold the emotion prompt from Advanced into this page (moves a setting).
5. Memory engine count: five engines plus legacy flags. Options: (a) show all five with one-line sentences and mark Supa/HypaV2 "older"; (b) hide Supa/HypaV2/Hanurai unless already selected (like legacy 'comfy' is today); (c) keep all equal.
6. HypaV3 presets: add "duplicate"; confirm before delete (exists); name prompt on create. Options: add duplicate now (new action, no data change) / leave as is / only list presets read-only.
7. Embedding model: shared by several features. Options: keep under 장기 기억; make a separate "임베딩" row linked from emotion, memory; move to 모델 page.
8. Experimental HypaV3 and rate limits: keep behind Advanced accordion / show only when experimental toggled (today) / hide from this redesign.
9. Translation cache buttons: llm only today. Options: keep llm-only (with explanation when hidden), show disabled for other types, move to Backup page.
10. Test paths: none exist for voice, image, translation. Options: simulated "try it" button per service in the mockup (flagged as new, needing app work) / only fetch-models check / none.
11. Memory ratio computed display needs a selected character: show a stand-in note, hide, or require the setting be reached from a chat.

## 10. Not verified
Did not run the app. Not read: `requestChatData` model fallback, removePunctuationHypa/showMemoryLimit locations, whether embedding model change invalidates stored vectors, mobile layout of this page, `hypaMemory`/`hypaMemoryKey` usage, help text of every field, `useExperimentalGoogleTranslator` UI location, `emotionInstructions` live path, CharConfig emotion/imggen subsections beyond lines named, NAI request code (stableDiff.ts:151-422), hypav3 internals beyond the lines cited.
