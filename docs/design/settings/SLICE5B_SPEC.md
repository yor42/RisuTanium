# Settings & models slice 5b: 대화 기능 (memory, voice, emotion images, image generation) and translation

Status: **draft, revision 1** (2026-10-28). Task: [tasks/2026-10-26-settings-models.md](../tasks/2026-10-26-settings-models.md).

Builds on:
- [SLICE1_SPEC.md](SLICE1_SPEC.md): shell, rows, search, changed dot, 기본값으로.
- [SLICE2_SPEC.md](SLICE2_SPEC.md): live save, undo, 최근 삭제.
- [SLICE3_SPEC.md](SLICE3_SPEC.md): 연결 cards, the 모델 page and its task models, key references.
- [SLICE4_SPEC.md](SLICE4_SPEC.md): the explain-only pattern, dimmed rows.
- [SLICE5A_SPEC.md](SLICE5A_SPEC.md): sub-page drill-in, Studio deep links.

Decisions in [DECISIONS-settings.md](DECISIONS-settings.md):
- **DS-127, scope:** 장기 기억, 음성, 감정 이미지 and 이미지 생성 on 대화 기능, and 번역, in one slice.
- **DS-128, service-specific fields:**
  - Image generation and voice share one pattern: pick a service, see its fields, test it.
  - Each fully mocks 2–3 services; the rest are listed by field names only.
- **DS-129, memory:** choosing an engine, with plain explanations, each engine's settings, and the HypaV3 preset editor. Viewing stored memories is out.
- **DS-130, voice:**
  - The global parts stay here: keys in 연결, the VOICEVOX address, auto-play.
  - A list of characters' voices links to Studio, and Studio links back.
  - No global default voice.
- **DS-131, image prompt:** prefix and negative stay per character. This page shows the active character's values read-only, with a Studio link.
- **DS-132, invented rows:** slice 1's rows with no source are removed. Only real settings appear.
- **DS-133, translation:** designed on the 언어 page, where it lives. 대화 기능 links to it.
- **DS-134, emotion images:**
  - Two methods with plain names.
  - The shared embedding model is named.
  - The emotion prompt moves here from 고급.
- **DS-135, memory engines:** all five engines with one-line explanations. Supa and HypaV2 are marked "이전 방식".
- **DS-136, HypaV3 presets:** 복제 is added, and create asks for a name.
- **DS-137, embedding model:** one "임베딩" row on the 모델 page. Memory and emotion link to it and say it is shared.
- **DS-138, experimental options:** experimental HypaV3 options appear only while experimental features are on, in a collapsed 고급 group.
- **DS-139, translation cache:** the cache tools appear for the LLM translator only. Other types show a one-line reason.
- **DS-140, 테스트:** a 테스트 action per service:
  - a short voice line;
  - a small test image;
  - a sample translation.
  - Simulated in the mockup, and flagged as new app work.

Earlier decisions that still bind:
- **Keys and addresses (DS-011, DS-013, DS-041):** every service key and address lives in 연결. A service here shows a **reference chip** to its connection, never a key field.
- **Per-task models (DS-044, DS-051):** the memory, emotion, translation and sub models are chosen on the 모델 page.
- **Live save and undo:** DS-019, DS-024 and DS-036/037.
- **Store-first:** DS-067.
- **Reset only where a default is known:** DS-010.
- **Explain-only on dimmed rows:** DS-096.
- **Korean register:** slice 1 §8 and DS-038. Say "첫 메시지".

Research: [research/slice5b-chatfeat.md](research/slice5b-chatfeat.md). Every "today" fact below is anchored there.

**Lane split:**
- **This lane:** the 대화 기능 page, the translator section on 언어, the 임베딩 row on 모델, and the emotion prompt's move.
- **Studio:** per-character voice (engine, voice, scales, quote-only), the image prompt, negative and writer instructions, emotion images, and `viewScreen`. Links go `owner=character:<id>&kind=…&from=settings`.
- **The chat lane:** the per-chat memory toggle and the per-chat translate view.

Marked **(design default)** = chosen here within the decided intent, open to veto.

## 0. Today

| Fact | research § |
|---|---|
| Memory type is five derived fields. An engine switch silently rewrites them. HypaV3 presets are global, the active one is stored by index, and the buttons are icon-only with no duplicate. "subModel" really means the memory task model. Max memory ratio needs a character. | 1 |
| The TTS tab holds keys, the VOICEVOX URL and auto-play. Engine and voice are per character. No test. VOICEVOX and non-English HF TTS depend on the translator. | 2 |
| Emotion: two methods. The embedding option is mislabelled "MiniLM" but uses the shared `hypaModel`. The prompt sits on 고급. | 3 |
| Image generation: 9 providers plus legacy `comfy`. Prompt and negative are per character. Each image costs a sub-model request plus the provider call. No test. | 4 |
| Translation lives on 언어. Cache tools are LLM-only. Source language is Google-only. "Ax. Model" and "Firefox" are raw labels. | 5 |
| Shared keys: OpenAI ×3 plus a separate `supaMemoryKey`; NovelAI ×3; Google ×2. TTS keys are not hidden. | 4.5, 7 |

## 1. Where things live

- **대화 기능** (`chatfeat`), in this section order:
  1. 장기 기억;
  2. 음성;
  3. 감정 이미지;
  4. 이미지 생성;
  5. 번역 (a link card to 언어 › 번역).
- **Rows removed per DS-132:** the slice 1 catalog rows research §8 lists:
  - `ttsSpeed`, `ttsSplit`, `ttsSkipCode`;
  - `emoShow`, `emoSize`, `emoCache`, `emoDefault`;
  - `imgAuto`, `imgSeed`, `imgStrength`, `imgRefChar`;
  - `memRatio`, `memRecent`, `memSim`, `memAuto`;
  - the global `elevenVoice`, `openaiVoice` and `voicevoxSpeaker`, which are per character.
  - Search synonyms of real moved items stay.
- **언어 › 번역:** the translator section (§6). Slice 1's chatfeat translation rows are replaced.
- **모델 › 임베딩** (DS-137): one row after the task models: "임베딩 모델 · 장기 기억, 감정 이미지, 추가 텍스트 등에서 같이 써요". It is a select with the 17 real options, grouped CPU / GPU (only when the device has WebGPU) / hosted / 직접 지정. A hosted option shows its connection chip.
- **고급:** the emotion prompt row goes. Its search synonyms point to 대화 기능 › 감정 이미지 (DS-134).
- **Sub-pages** (drill-in with Back, as slice 5a):
  - `view=memory-preset&id=<presetId>`: the HypaV3 preset editor;
  - `view=imggen&svc=<id>`: a service's fields;
  - `view=voices`: the character voice list;
  - `view=trpreset&id=`: an LLM translator preset.
- **Search:** finds every real field by its KO, EN and code name (e.g. `hypaV3`, `webUiUrl`, `ttsAutoSpeech`), plus preset names and service names.

## 2. 장기 기억 (DS-129, DS-135, DS-136, DS-138)

### 2.1 Engine choice

- **Layout:** a radio list (one choice), not a select. Each option has its name and one plain sentence:
  - **끄기:** "오래된 메시지는 그냥 맥락에서 빠져요".
  - **HypaMemory V3:** "오래된 대화를 요약하고, 관련 있는 요약을 찾아 함께 보내요 · 프리셋으로 조절해요". Recommended chip "권장" (design default; today's newest engine).
  - **HanuraiMemory:** "요약 없이 비슷한 메시지만 찾아서 보내요".
  - **HypaMemory V2** `이전 방식`: "요약과 검색을 함께 써요".
  - **SupaMemory** `이전 방식`: "오래된 대화를 한 덩어리로 요약해 보내요".
- **Switching engines:** live save with an undo toast: "장기 기억을 'HypaMemory V3'(으)로 바꿨어요 · 되돌리기". The derived fields are written together, as today; undo restores all five (engine note).
- **Under the list:** a status line: "채팅마다 켜고 끌 수 있어요 · 채팅 메뉴의 '장기 기억'". The per-chat toggle stays in chat.
- **Costs** (design default; today shows none):
  - Engines that summarise show "요약할 때 기억 모델로 요청을 더 보내요", with a link to 모델 › 기억.
  - Local models show "처음 쓸 때 모델을 내려받아요 (약 {size})". Sizes are synthetic.

### 2.2 Per-engine settings (shown under the choice; real fields only, research §1.2)

- **HypaMemory V3:**
  - **Preset bar:** the active preset name as a select-like button, plus a `⋯` menu:
    - 새로 만들기, which asks for a name (DS-136);
    - 복제 (DS-136);
    - 이름 바꾸기;
    - 내보내기 / 가져오기;
    - 삭제, which confirms and gives an undo toast. Disabled on the last preset with "프리셋이 하나는 있어야 해요".
  - **편집 opens `view=memory-preset`.**
  - **Summary:** a three-line summary of the active preset: 기억 비율, 최근/비슷한/무작위, 요약 모델.
- **HanuraiMemory:** 청크 크기 (`hanuraiTokens`, number ≥ 100, default 1000) and 문장 나누기 (`hanuraiSplit`).
- **HypaMemory V2:**
  - 요약 모델 (see below);
  - 청크 크기 (`hypaChunkSize`, default 3000);
  - 할당 토큰 (`hypaAllocatedTokens`, default 3000);
  - 요약 프롬프트 (textarea; blank = default, shown as a placeholder).
- **SupaMemory:**
  - 요약 모델;
  - 최대 청크 (`maxSupaChunkSize`, default 1200);
  - 요약 프롬프트 (single line);
  - "검색도 함께 쓰기" (`hypaMemory`).
- **요약 모델** (Supa, V2, V3), with options:
  - "기억 모델 (모델 페이지에서 정해요)", which replaces the "subModel" label;
  - the local options with their download notes;
  - for Supa and V2, `instruct35`, which needs an OpenAI connection (DS-011; today the separate `supaMemoryKey`, engine note).
- **임베딩 (vector engines):** a read-only line "임베딩: {model} · 모델 페이지에서 바꿔요 · 감정 이미지와 같이 써요" (DS-137).

### 2.3 HypaV3 preset editor (`view=memory-preset`)

- **Fields:** the fields of research §1.3 as rows.
- **Ratios:**
  - The three ratios (최근, 비슷한, 무작위) are one stacked bar with two handles. 무작위 is the remainder and read-only. A keyboard user edits the two ratios as sliders with number fields, and the sum is clamped live (fixes the "0 never clamped" defect).
  - 기억 비율 is a slider, with 추가 요약 비율 limited to 1 − 기억 비율.
- **최대 기억 비율:** with no character selected it reads "캐릭터를 고르면 계산해요". With one selected (a demo toggle), it shows a synthetic number.
- **Separator:** `summaryChunkSeparator` is shown as visible escapes (`\n\n`) with help.
- **고급, collapsed:** `useExperimentalImpl` and `alwaysToggleOn`. The rate-limit fields appear only while experimental is on (DS-138). `enableSimilarityCorrection` shows when experimental is off.
- **Reset:** changed dots and 기본값으로 per field, using `createHypaV3Preset` defaults (DS-010). A 프리셋 전체 기본값으로 action is one undo step.

## 3. 음성 (DS-130, DS-128, DS-140)

- **자동으로 읽기** (`ttsAutoSpeech`): a switch with "목소리가 정해진 캐릭터의 답변이 끝나면 읽어요".
- **Services:** a list of the engines that need something global:
  - ElevenLabs (key);
  - VOICEVOX (address);
  - OpenAI (key);
  - NovelAI (key);
  - Hugging Face (key);
  - Fish Audio (key).
- **Each service row:**
  - the name;
  - the reference chip "연결: {name}", or "연결 필요" with "연결 추가", which opens slice 3's connection add with this service preset;
  - a 테스트 button (DS-140).
- **Worked in full** (DS-128):
  - **ElevenLabs:** a key reference, with the model fixed to multilingual v2, shown read-only.
  - **VOICEVOX:** an address reference to a 연결 address entry (DS-013), and "VOICEVOX는 일본어로 번역해서 읽어요 · 번역 설정을 써요", with a link to 언어 › 번역.
  - **OpenAI:** "채팅과 같은 OpenAI 연결을 써요", plus the note that a character can use its own endpoint (Studio).
- **Listed only:** NovelAI, Hugging Face, Fish Audio, browser voice, VITS and GPT-SoVITS, by name and what they need ("키", "주소", "캐릭터에서 파일 선택", "없음").
- **테스트:**
  - The button speaks "안녕하세요, 목소리 테스트예요" (synthetic: a waveform animation plus a status line).
  - Failure states: missing key, unreachable address, and the HF 503 warm-up ("모델을 깨우는 중이에요 · 최대 30초").
  - Reduced motion: no waveform animation.
- **캐릭터 목소리** (`view=voices`, DS-130):
  - Each character's row shows the engine and voice, and "따옴표 안만 읽기" when on.
  - Each row has an `external-link` "Studio에서 바꾸기" (`kind=…` the voice section; integration note on the kind id).
  - A character with no voice reads "목소리 없음".
  - Synthetic: 4 characters with different engines.

## 4. 감정 이미지 (DS-134, DS-137)

- **방식, two radios:**
  - **감정 모델 (`submodel`):** label "감정 모델이 골라요", with "모델 페이지의 감정 모델에게 짧게 물어봐요 · 요청이 하나 더 가요". Links to 모델 › 감정.
  - **임베딩으로 고르기:** label "문장 비슷함으로 골라요", with "요청 없이 기기에서 계산해요 · 임베딩: {model} (장기 기억과 같이 써요)". Links to 모델 › 임베딩.
- **감정 프롬프트** (`emotionPrompt2`), moved from 고급:
  - a textarea, blank = built-in default (shown as a placeholder, in English as today), with 기본값으로;
  - only applies to the 감정 모델 method; dimmed with the reason under the embedding method (DS-096 explain-only).
- **Studio link:** "감정 이미지는 캐릭터마다 정해요 · Studio에서 열기" opens the active character's display kind.
- **Synthetic:** 8 emotion names on the demo character.

## 5. 이미지 생성 (DS-128, DS-131, DS-140)

- **서비스:** a radio list of the 9 providers plus "끄기". Legacy `comfy` appears only if already selected (as today), marked `이전 방식`.
- **Each provider:** a name, a one-line "what it needs" (주소 / 키 / 주소+키), and the connection chip.
- **Cost line:** "이미지 하나에 보조 모델 요청 1번 + 서비스 요청 1번".
- **Active service:** shows its fields inline on wide screens, or as `view=imggen&svc=` on phones (design default).
- **Worked in full:**
  - **OpenAI 호환:**
    - address and key via a connection;
    - 모델 (text);
    - 크기 (5 options, a segmented control or a select);
    - 품질 auto/low/medium/high.
  - **Stable Diffusion WebUI:**
    - address via a connection;
    - 단계 (0–100);
    - CFG (0–20);
    - 너비/높이 (≤ 2048), with the shared size note "Fal과 같은 크기를 써요";
    - 샘플러, a **select of common samplers with "직접 입력"** (design default; today it is free text);
    - Hires group, collapsed: 노이즈 제거 강도, 배율, 업스케일러.
    - Notices: the `--api` flag, the licence, and the tunnel on the web.
  - **WaveSpeed:**
    - a key reference;
    - 모델 from a **fetched list**: a searchable list with price and support ticks, a refresh button, fetch-failed and empty states, and synthetic data;
    - LoRA rows (up to 3) when the model supports them;
    - reference none/image/character when supported.
- **Listed only** (by field names, from research §4.1): NovelAI, DALL·E, Stability, Fal, ComfyUI, Imagen.
- **프롬프트 (DS-131):** read-only, "{character} · 앞에 붙는 말 / 빼는 말". The first lines are shown, with "Studio에서 바꾸기". With no character selected: "캐릭터를 고르면 보여 줘요".
- **테스트 (DS-140):**
  - Uses a fixed synthetic prompt and the smallest size, and shows a placeholder image (an SVG tile) with time and cost lines.
  - Failures: missing key, unreachable address, ComfyUI timeout, WaveSpeed model not chosen.

## 6. 언어 › 번역 (DS-133, DS-139, DS-140)

- **번역할 언어** (`translator`): "끄기" plus the real list. zh-TW and fa show "Google에서만" and are disabled with the reason for the other types.
- **번역 방식** (`translatorType`), as a radio list with plain labels:
  - Google: "무료 · 공개 주소를 써요";
  - DeepL: needs a connection key; the free-key switch; the web warning;
  - DeepLX: an address and token via a connection;
  - **AI 모델:** replaces "Ax. Model"; uses the translation task model (link to 모델 › 번역) and the presets;
  - **기기에서 번역 (Firefox 엔진):** replaces "Firefox"; local, "처음 쓸 때 모델을 내려받아요".
- **원문 언어:** for Google only. Other types hide it, with a note (design default: hidden rather than dimmed, because it is type-specific).
- **Switches, with help:** 자동 번역, 번역 합치기, 이전 번역 방식, and HTML 번역 (Firefox engine only).
- **AI 모델 only:** "HTML 서식 전에 번역", "저장된 번역만 자동으로", and the presets.
- **AI 번역 프리셋:** the same bar as the HypaV3 presets (§2.2): new with a name, 복제, rename, export `.risutl`, import, and delete with undo. The preset sub-page holds the prompt (`{{slot}}` = target language, explained) and the max response (0–2048).
- **번역 캐시** (DS-139):
  - AI 모델: 내보내기, 가져오기 (confirm) and 비우기 (confirm, then undo for 10 s; synthetic), with "저장된 번역 {n}개".
  - Other types: "번역 캐시는 AI 모델 방식에만 있어요".
- **테스트:** "안녕하세요" → the target language (synthetic), with failures for a missing key and an unreachable address.
- **Link back:** "음성: VOICEVOX가 이 번역을 써요" when a VOICEVOX connection exists.

## 7. Keyboard, motion, accessibility

- **Radio lists:**
  - native radio groups with `fieldset`/`legend`;
  - the explanation is linked by `aria-describedby`;
  - "권장" and "이전 방식" are text, not only colour.
- **Ratio bar:** two sliders with `aria-valuetext` ("최근 40%"). The remainder is announced on change.
- **Fetched lists:** the WaveSpeed model list is a listbox with type-ahead. Refreshing announces "모델 {n}개를 불러왔어요" or the failure.
- **테스트:** a button with a live status line, and it can be cancelled.
- **Back stack:**
  1. dialog or menu;
  2. sub-page;
  3. slice 1's order.
- **Motion:** expand and collapse at token durations. Reduced motion is a 120 ms crossfade, with no waveform. Low power is instant.
- **Targets and widths:** 44 dp targets. At 360 px every select and radio list wraps, and the preset bar collapses its actions into `⋯`.
- **Forced colours:** chips, markers and warnings keep their borders and text.

## 8. Integration map (Lane A)

| Change | Where |
|---|---|
| A memory engine as one stored value (`memoryEngine`), with the five derived fields migrated, not rewritten piecemeal. Undo restores it. | `OtherBotSettings.svelte:1015-1054`, `database.svelte.ts` |
| HypaV3 presets: an id instead of an index, a 복제 action, a name on create, and a notice on importing a foreign file. The label "subModel" becomes the memory task model. | `hypav3.ts:1804-1848`, `hypaV3PresetImport.ts` |
| The embedding model moves to the 모델 page as a shared setting. Emotion is relabelled. | `OtherBotSettings.svelte:1004-1007, 1294-1332` |
| Keys and addresses come from connections (DS-011/013). `supaMemoryKey` and `voyageApiKey` become connection references. The NovelAI, OpenAI and Google keys stay single per connection. | slice 3 item 3-1 |
| The emotion prompt moves from Advanced to 대화 기능. | `advancedSettingsData.ts:35` |
| Image generation: a sampler list for WebUI, provider rows from a schema, WaveSpeed's list as a searchable listbox. | `OtherBotSettings.svelte:263-975` |
| Test actions for voice, image and translation (new). | `tts.ts`, `stableDiff.ts`, `translator.ts` |
| Translator: plain labels, type-gated fields with reasons, preset 복제 and name, cache undo. | `languageSettingsData.svelte.ts`, `TranslatorPresetSettings.svelte` |
| Slice 1's invented rows are removed from the catalog (DS-132). | design catalog only |
| Strings: about 200 keys. | `src/lang/en.ts`, `ko.ts` |
| ENGINE_CHANGES.md gains items 5b-1 to 5b-n when this slice closes. | this lane |

## 9. Korean copy

Filled by the builder from `data5b.js` (generated by `checks/tools/gen-copy5b.mjs`). The table covers every label, explanation, warning, failure and empty state above; `koen` reads it back and compares it with the page.

| Key | 한국어 | English |
|---|---|---|
| **Sections** | | |
| `group:chatfeat.memory` | 장기 기억 | Long-term memory |
| `group:chatfeat.voice` | 음성 | Voice |
| `group:chatfeat.emotion` | 감정 이미지 | Emotion images |
| `group:chatfeat.imagegen` | 이미지 생성 | Image generation |
| `group:chatfeat.translate` | 번역 | Translation |
| `group:lang.translate` | 번역 | Translation |
| **Catalogue rows: label and description (search and the rows of the pages)** | | |
| `row:chatfeat.memEngine` | 장기 기억 방식 | Long-term memory type |
| `row:chatfeat.hanuraiTokens` | 청크 크기 (HanuraiMemory) | Chunk size (HanuraiMemory) |
| `rowdesc:chatfeat.hanuraiTokens` | 검색할 때 메시지를 묶는 크기예요. 100 이상 | The size of the groups messages are cut into for search. At least 100 |
| `row:chatfeat.hanuraiSplit` | 문장 나누기 | Split into sentences |
| `row:chatfeat.hypaChunkSize` | 청크 크기 (HypaMemory V2) | Chunk size (HypaMemory V2) |
| `rowdesc:chatfeat.hypaChunkSize` | 한 번에 요약하는 글의 크기예요. 100 이상 | How much text is summarised at once. At least 100 |
| `row:chatfeat.hypaAllocatedTokens` | 할당 토큰 (HypaMemory V2) | Allocated tokens (HypaMemory V2) |
| `rowdesc:chatfeat.hypaAllocatedTokens` | 요약과 검색에 쓸 토큰 수예요. 100 이상 | Tokens given to summaries and search. At least 100 |
| `row:chatfeat.supaModelType` | 요약 모델 | Summary model |
| `row:chatfeat.maxSupaChunkSize` | 최대 청크 (SupaMemory) | Max chunk size (SupaMemory) |
| `rowdesc:chatfeat.maxSupaChunkSize` | 한 덩어리로 요약할 글의 최대 크기예요. 100 이상 | The largest piece of text summarised as one block. At least 100 |
| `row:chatfeat.supaMemoryPrompt` | 요약 프롬프트 | Summary prompt |
| `rowdesc:chatfeat.supaMemoryPrompt` | 비워 두면 기본 프롬프트를 써요 | Blank uses the built-in prompt |
| `row:chatfeat.hypaMemory` | 검색도 함께 쓰기 | Also use vector search |
| `row:chatfeat.hv3.summarizationModel` | 요약 모델 (프리셋) | Summary model (preset) |
| `row:chatfeat.hv3.summarizationPrompt` | 요약 프롬프트 (프리셋) | Summary prompt (preset) |
| `rowdesc:chatfeat.hv3.summarizationPrompt` | 비워 두면 기본 프롬프트를 써요 | Blank uses the built-in prompt |
| `row:chatfeat.hv3.reSummarizationPrompt` | 다시 요약 프롬프트 | Re-summary prompt |
| `rowdesc:chatfeat.hv3.reSummarizationPrompt` | 요약을 한 번 더 줄일 때 써요. 비워 두면 기본 프롬프트를 써요 | Used when a summary is shortened again. Blank uses the built-in prompt |
| `row:chatfeat.hv3.memoryTokensRatio` | 기억 비율 | Memory ratio |
| `rowdesc:chatfeat.hv3.memoryTokensRatio` | 프롬프트에서 기억이 차지할 몫이에요 | The share of the prompt memory may take |
| `row:chatfeat.hv3.extraSummarizationRatio` | 추가 요약 비율 | Extra summary ratio |
| `rowdesc:chatfeat.hv3.extraSummarizationRatio` | 기억 비율을 뺀 나머지 안에서만 정할 수 있어요 | Can only be set within what is left after the memory ratio |
| `row:chatfeat.hv3.maxChatsPerSummary` | 요약 하나에 묶는 채팅 수 | Chats per summary |
| `row:chatfeat.hv3.queryChatCount` | 검색에 쓰는 최근 채팅 수 | Chats used as the search query |
| `row:chatfeat.hv3.summaryChunkSeparator` | 요약 구분자 | Summary separator |
| `rowdesc:chatfeat.hv3.summaryChunkSeparator` | 요약을 이어 붙일 때 사이에 넣는 글자예요 | What goes between joined summaries |
| `row:chatfeat.hv3.recentMemoryRatio` | 최근 몫 | Recent share |
| `row:chatfeat.hv3.similarMemoryRatio` | 비슷한 몫 | Similar share |
| `row:chatfeat.hv3.preserveOrphanedMemory` | 짝 잃은 요약 남기기 | Keep orphaned summaries |
| `rowdesc:chatfeat.hv3.preserveOrphanedMemory` | 지운 메시지에 달려 있던 요약도 그대로 둬요 | Keeps summaries whose messages were deleted |
| `row:chatfeat.hv3.processRegexScript` | 정규식 스크립트 적용 | Apply regex scripts |
| `rowdesc:chatfeat.hv3.processRegexScript` | 요약하기 전에 정규식 스크립트를 먼저 돌려요 | Runs regex scripts before summarising |
| `row:chatfeat.hv3.doNotSummarizeUserMessage` | 내 메시지는 요약하지 않기 | Do not summarise my messages |
| `row:chatfeat.hv3.useExperimentalImpl` | 실험적 구현 쓰기 | Use the experimental implementation |
| `rowdesc:chatfeat.hv3.useExperimentalImpl` | 켜면 속도 제한 설정이 나와요 | Shows the rate limit settings when on |
| `row:chatfeat.hv3.alwaysToggleOn` | 캐릭터를 고르면 자동으로 켜기 | Turn on automatically when a character is chosen |
| `rowdesc:chatfeat.hv3.alwaysToggleOn` | 캐릭터를 고를 때 채팅의 장기 기억을 자동으로 켜요 | Turns the chat's long-term memory on when a character is chosen |
| `row:chatfeat.hv3.summarizationRequestsPerMinute` | 요약 요청 (분당) | Summary requests (per minute) |
| `row:chatfeat.hv3.summarizationMaxConcurrent` | 요약 동시 요청 | Summary requests at once |
| `row:chatfeat.hv3.embeddingRequestsPerMinute` | 임베딩 요청 (분당) | Embedding requests (per minute) |
| `row:chatfeat.hv3.embeddingMaxConcurrent` | 임베딩 동시 요청 | Embedding requests at once |
| `row:chatfeat.hv3.enableSimilarityCorrection` | 비슷함 보정 | Similarity correction |
| `row:models.embedModel` | 임베딩 모델 | Embedding model |
| `rowdesc:models.embedModel` | 장기 기억, 감정 이미지, 추가 텍스트 등에서 같이 써요 | Shared by long-term memory, emotion images, additional text and more |
| `row:models.embedCustomModel` | 직접 지정 임베딩 모델 이름 | Custom embedding model name |
| `row:chatfeat.ttsAutoSpeech` | 자동으로 읽기 | Read aloud automatically |
| `rowdesc:chatfeat.ttsAutoSpeech` | 목소리가 정해진 캐릭터의 답변이 끝나면 읽어요 | Reads a reply aloud when it ends, for characters that have a voice |
| `row:chatfeat.emotionProcesser` | 감정 고르는 방식 | How the emotion is chosen |
| `row:chatfeat.emotionPrompt2` | 감정 프롬프트 | Emotion prompt |
| `rowdesc:chatfeat.emotionPrompt2` | 비워 두면 기본 프롬프트(영어)를 써요 | Blank uses the built-in prompt (in English) |
| `row:chatfeat.sdProvider` | 이미지 생성 서비스 | Image generation service |
| `row:chatfeat.sdSteps` | 단계 수 | Steps |
| `row:chatfeat.sdCFG` | CFG | CFG scale |
| `row:chatfeat.sdWidth` | 너비 | Width |
| `rowdesc:chatfeat.sdWidth` | Fal과 같은 크기를 써요 (최대 2048) | Shared with Fal (up to 2048) |
| `row:chatfeat.sdHeight` | 높이 | Height |
| `rowdesc:chatfeat.sdHeight` | Fal과 같은 크기를 써요 (최대 2048) | Shared with Fal (up to 2048) |
| `row:chatfeat.sdSampler` | 샘플러 | Sampler |
| `row:chatfeat.sdHr` | 고해상도 보정 | Hires fix |
| `row:chatfeat.sdDenoise` | 노이즈 제거 강도 | Denoising strength |
| `row:chatfeat.sdHrScale` | 배율 | Scale |
| `row:chatfeat.sdHrUpscaler` | 업스케일러 | Upscaler |
| `row:chatfeat.oaiImgModel` | 모델 | Model |
| `row:chatfeat.oaiImgSize` | 크기 | Size |
| `row:chatfeat.oaiImgQuality` | 품질 | Quality |
| `row:chatfeat.wsRef` | 참고 이미지 | Reference |
| `row:lang.translator` | 번역할 언어 | Translate into |
| `row:lang.translatorType` | 번역 방식 | Translation method |
| `row:lang.translatorInputLanguage` | 원문 언어 | Source language |
| `rowdesc:lang.translatorInputLanguage` | Google에서만 고를 수 있어요 | Only Google lets you choose this |
| `row:lang.trPrompt` | 번역 프롬프트 | Translation prompt |
| `rowdesc:lang.trPrompt` | 비워 두면 기본 프롬프트를 써요. {{slot}}은 번역할 언어로 바뀌어요 | Blank uses the built-in prompt. {{slot}} becomes the target language |
| `row:lang.trMaxResponse` | 최대 응답 길이 | Max response length |
| `rowdesc:lang.trMaxResponse` | 번역 하나에 쓸 수 있는 토큰이에요. 0에서 2048 | Tokens one translation may use. 0 to 2048 |
| `row:lang.autoTranslate` | 자동 번역 | Translate automatically |
| `rowdesc:lang.autoTranslate` | 새 메시지가 오면 바로 번역해요 | Translates new messages as they arrive |
| `row:lang.combineTranslation` | 번역 합치기 | Combine translations |
| `rowdesc:lang.combineTranslation` | 원문과 번역을 한 메시지에 같이 보여 줘요 | Shows the original and the translation together in one message |
| `row:lang.legacyTranslation` | 이전 번역 방식 | Older translation method |
| `rowdesc:lang.legacyTranslation` | 예전 방식으로 문단을 나눠 번역해요 | Translates paragraph by paragraph the old way |
| `row:lang.htmlTranslation` | HTML 번역 | HTML translation |
| `rowdesc:lang.htmlTranslation` | 기기에서 번역할 때 HTML 서식을 그대로 둬요 | Keeps HTML formatting when translating on this device |
| `row:lang.translateBeforeHTMLFormatting` | HTML 서식 전에 번역 | Translate before HTML formatting |
| `row:lang.autoTranslateCachedOnly` | 저장된 번역만 자동으로 | Auto-translate saved translations only |
| `rowdesc:lang.autoTranslateCachedOnly` | 이미 번역한 메시지만 자동으로 보여 줘요 | Only shows translations that already exist |
| `row:chatfeat.trLink` | 번역은 언어 페이지에서 설정해요 | Translation is set on the Language page |
| `rowdesc:chatfeat.trLink` | 번역할 언어와 방식, AI 번역 프리셋, 번역 캐시 | The language, the method, AI translation presets and the cache |
| `row:models.hfKey` | Hugging Face 키 | Hugging Face key |
| `row:models.stabilityKey` | Stability AI 키 | Stability AI key |
| `row:models.falKey` | Fal 키 | Fal key |
| `row:models.voyageKey` | Voyage 키 | Voyage key |
| **Copy: Connections and services** | | |
| `connChip('ElevenLabs')` | 연결: ElevenLabs | Connection: ElevenLabs |
| `connNeed` | 연결 필요 | Connection needed |
| `connAdd` | 연결 추가 | Add connection |
| `connAddOf('ElevenLabs')` | 연결 추가: ElevenLabs | Add connection: ElevenLabs |
| `connAria('ElevenLabs')` | 연결: ElevenLabs · 열기 | Connection: ElevenLabs · open |
| `connOpen` | 연결 페이지에서 열기 | Open on the Connections page |
| `needKey` | 키 | Key |
| `needAddr` | 주소 | Address |
| `needAddrKey` | 주소 + 키 | Address + key |
| `needAddrToken` | 주소와 토큰 | Address and token |
| `needNone` | 없음 | None |
| `needFile` | 캐릭터에서 파일 선택 | Pick a file in the character |
| `svcAddTitle('ElevenLabs')` | 연결 추가: ElevenLabs | Add connection: ElevenLabs |
| `svcAddKeyHint` | 키는 이 기기에만 저장돼요 | The key stays on this device |
| `svcAddAddrHint` | 주소는 http:// 또는 https://로 시작해요 | The address starts with http:// or https:// |
| `svcAddr` | 주소 | Address |
| `svcKey` | 키 | Key |
| `svcSave` | 저장 | Save |
| `svcAddrBad` | 주소는 http:// 또는 https://로 시작해야 해요 | The address must start with http:// or https:// |
| `svcKeyBad` | 키를 입력하세요 | Enter a key |
| `svcAdded('ElevenLabs')` | 연결을 추가했어요: ElevenLabs | Connection added: ElevenLabs |
| `luSvc('ElevenLabs')` | 연결 추가: ElevenLabs | add connection: ElevenLabs |
| **Copy: Tests** | | |
| `test` | 테스트 | Test |
| `testOf('ElevenLabs')` | 테스트: ElevenLabs | Test: ElevenLabs |
| `testCancel` | 취소 | Cancel |
| `testCancelOf('ElevenLabs')` | 테스트 취소: ElevenLabs | Cancel test: ElevenLabs |
| `testRunning` | 테스트하는 중이에요… | Testing… |
| `testRunVoice` | “안녕하세요, 목소리 테스트예요”를 읽는 중이에요… | Reading “Hello, this is a voice test” aloud… |
| `testRunImage` | 작은 테스트 이미지를 만드는 중이에요… | Making a small test image… |
| `testRunTr` | 샘플 문장을 번역하는 중이에요… | Translating a sample sentence… |
| `testCancelled` | 테스트를 취소했어요 | Test cancelled |
| `testOkShort` | 테스트에 성공했어요 | The test worked |
| `testOkVoice` | 읽었어요 · “안녕하세요, 목소리 테스트예요” | Read it aloud · “Hello, this is a voice test” |
| `testOkImage('2.4','무료')` | 2.4초 걸렸어요 · 예상 비용 무료 | Took 2.4 s · estimated cost 무료 |
| `testOkImageNoCost('2.4')` | 2.4초 걸렸어요 | Took 2.4 s |
| `testOkTr('안녕하세요, 만나서 반가워요.')` | “Hello, nice to meet you.” → 안녕하세요, 만나서 반가워요. | “Hello, nice to meet you.” → 안녕하세요, 만나서 반가워요. |
| `costFree` | 무료 | Free |
| `testOffline` | 번역 서버에 닿지 못했어요 · 인터넷 연결을 확인하세요 | Could not reach the translation server · check your internet connection |
| `testNoTrModel` | 번역에 쓸 모델이 없어요 · 모델 페이지에서 정해요 | No model is set for translation · choose one on the Models page |
| `testDlFail` | 번역 모델을 내려받지 못했어요 · 인터넷 연결을 확인하세요 | Could not download the translation model · check your internet connection |
| `testPaid` | 요금이 나갈 수 있어요 | This may cost money |
| `testVoiceUses('세라핀','Rachel')` | 테스트 목소리: 세라핀 · Rachel | Test voice: 세라핀 · Rachel |
| `testVoiceDefault` | 이 서비스를 쓰는 캐릭터가 없어서 서비스의 기본 목소리로 읽어요 | No character uses this service, so the default voice of the service reads it |
| `costDownloadNoSize` | 처음 쓸 때 모델을 내려받아요 | Downloads the model the first time you use it |
| `testNoKey` | 연결에 키가 없어요 · 연결을 먼저 추가하세요 | The connection has no key · add the connection first |
| `testNoAddr` | 연결에 주소가 없어요 · 연결을 먼저 추가하세요 | The connection has no address · add the connection first |
| `testUnreachable` | 주소에 닿지 못했어요 · 서버가 켜져 있는지 확인하세요 | Could not reach the address · check that the server is running |
| `testBadKey` | 서비스가 키를 받아 주지 않았어요 · 키를 다시 확인하세요 | The service did not accept the key · check the key again |
| `testTimeout` | 시간 안에 답이 오지 않았어요 (ComfyUI · 60초) | No answer in time (ComfyUI · 60 s) |
| `testWarming` | 모델을 깨우는 중이에요 · 최대 30초 · 잠시 뒤에 다시 시도하세요 | Waking the model up · up to 30 s · try again in a moment |
| `testNoModel` | WaveSpeed 모델을 먼저 고르세요 | Pick a WaveSpeed model first |
| `costRequests` | 요약할 때 기억 모델로 요청을 더 보내요 | Summaries send extra requests to the memory model |
| `costDownload('118 MB')` | 처음 쓸 때 모델을 내려받아요 (약 118 MB) | Downloads the model the first time you use it (about 118 MB) |
| **Copy: Undo and numbers** | | |
| `luSkip` | 그 사이에 바뀌어서 되돌리지 않았어요 | It changed in the meantime, so nothing was undone |
| `luEdit('단계 수')` | 단계 수 바꾸기 | change 단계 수 |
| `luEngine` | 장기 기억 방식 바꾸기 | change the long-term memory type |
| `luPmChoose('프리셋')` | 프리셋 고르기 | choose 프리셋 |
| `luPmNew('프리셋')` | 프리셋 만들기 | create 프리셋 |
| `luPmDup('프리셋')` | 프리셋 복제 | duplicate 프리셋 |
| `luPmRename('밤 이야기')` | ‘밤 이야기’ 이름 바꾸기 | rename "밤 이야기" |
| `luPmImport('프리셋')` | 프리셋 가져오기 | import 프리셋 |
| `luPmDel('밤 이야기')` | ‘밤 이야기’ 지우기 | delete "밤 이야기" |
| `luPedReset('밤 이야기')` | ‘밤 이야기’ 기본값으로 | reset "밤 이야기" to defaults |
| `luWsModel` | 모델 고르기 | choose a model |
| `luLoraAdd` | LoRA 추가 | add a LoRA |
| `luLoraDel` | LoRA 지우기 | remove a LoRA |
| `luCacheImport` | 번역 캐시 가져오기 | import the translation cache |
| `luCacheClear` | 번역 캐시 비우기 | clear the translation cache |
| `resetDone('단계 수')` | 기본값으로 되돌렸어요: 단계 수 | Reset to its default: 단계 수 |
| `numBad('단계 수',0,100)` | 단계 수: 0에서 100 사이로 입력하세요 | 단계 수: enter a value from 0 to 100 |
| `numRange(0,100)` | 0에서 100 사이로 입력하세요 | Enter a value from 0 to 100 |
| `numMin('청크 크기',100)` | 청크 크기: 100 이상으로 입력하세요 | 청크 크기: enter 100 or more |
| `numMinR(100)` | 100 이상으로 입력하세요 | Enter 100 or more |
| **Copy: Long-term memory** | | |
| `memAlways` | HypaMemory V3는 프리셋에서 ‘캐릭터를 고르면 자동으로 켜기’를 켜면 새 채팅에서 저절로 켜져요 | HypaMemory V3: turn on ‘Turn on automatically when a character is chosen’ in the preset and memory starts on in new chats |
| `memLegend` | 장기 기억 방식 | Long-term memory type |
| `engNoneN` | 끄기 | Off |
| `engNone` | 오래된 메시지는 그냥 맥락에서 빠져요 | Old messages simply drop out of the context |
| `engV3` | 오래된 대화를 요약하고, 관련 있는 요약을 찾아 함께 보내요 · 프리셋으로 조절해요 | Summarises old conversation and sends the relevant summaries along · tuned with presets |
| `engHanurai` | 요약 없이 비슷한 메시지만 찾아서 보내요 | Finds and sends similar messages, with no summaries |
| `engV2` | 요약과 검색을 함께 써요 | Uses summaries and search together |
| `engSupa` | 오래된 대화를 한 덩어리로 요약해 보내요 | Summarises old conversation into one block and sends it |
| `tagRec` | 권장 | Recommended |
| `tagOld` | 이전 방식 | Older method |
| `memPerChat` | 채팅마다 켜고 끌 수 있어요 · 채팅 메뉴의 ‘장기 기억’ | Each chat can turn it on or off · “Long-term memory” in the chat menu |
| `engSwitched('HypaMemory V3')` | 장기 기억을 ‘HypaMemory V3’(으)로 바꿨어요 | Long-term memory is now “HypaMemory V3” |
| `memNeedOpenai` | OpenAI 연결이 필요해요 | Needs an OpenAI connection |
| `memModelIs('Claude Sonnet 4.5')` | 기억 모델: Claude Sonnet 4.5 | Memory model: Claude Sonnet 4.5 |
| `memModelGo` | 모델 페이지에서 바꾸기 | Change on the Models page |
| `memSumMem('Claude Sonnet 4.5')` | 기억 모델 (Claude Sonnet 4.5) | Memory model (Claude Sonnet 4.5) |
| `memEmbA('Multilingual MiniLM L12 v2')` | 임베딩: Multilingual MiniLM L12 v2 ·  | Embedding: Multilingual MiniLM L12 v2 ·  |
| `memEmbGo` | 모델 페이지에서 바꿔요 | Change on the Models page |
| `memEmbB` |  · 감정 이미지와 같이 써요 |  · shared with emotion images |
| `memEmbC` |  · 장기 기억과 같이 써요 |  · shared with long-term memory |
| `pmLabelMem` | 프리셋 | Preset |
| `pmLabelTr` | 번역 프리셋 | Translation preset |
| `pmChooseAria('밤 이야기')` | 프리셋 고르기 (지금: 밤 이야기) | Choose preset (now: 밤 이야기) |
| `pmChooseMenu` | 프리셋 고르기 | Choose a preset |
| `pmEdit` | 편집 | Edit |
| `pmEditAria('밤 이야기')` | 프리셋 편집: 밤 이야기 | Edit preset: 밤 이야기 |
| `pmMenuAria` | 프리셋 메뉴 | Preset menu |
| `pmNew` | 새로 만들기 | New |
| `pmDup` | 복제 | Duplicate |
| `pmRename` | 이름 바꾸기 | Rename |
| `pmExport('.json')` | 내보내기 (.json) | Export (.json) |
| `pmImport` | 가져오기 | Import |
| `pmDelete` | 삭제 | Delete |
| `pmLast` | 프리셋이 하나는 있어야 해요 | There must be at least one preset |
| `pmNewT` | 새 프리셋 | New preset |
| `pmName` | 이름 | Name |
| `pmCreate` | 만들기 | Create |
| `pmNameTaken` | 같은 이름의 프리셋이 있어요 | A preset with this name exists |
| `pmNewNameMem` | 새 프리셋 | New preset |
| `pmNewNameTr` | 새 번역 프리셋 | New translation preset |
| `pmCopyName('밤 이야기')` | 밤 이야기 복사본 | 밤 이야기 copy |
| `pmCreated` | 프리셋을 만들었어요 | Preset created |
| `pmDuped` | 프리셋을 복제했어요 | Preset duplicated |
| `pmRenameT` | 이름 바꾸기 | Rename |
| `pmRenameDo` | 바꾸기 | Rename |
| `pmRenamed` | 이름을 바꿨어요 | Renamed |
| `pmExported` | 내보냈어요 | Exported |
| `pmImportT` | 프리셋 가져오기 | Import a preset |
| `pmImportPick` | 가져올 파일을 고르세요 | Choose the file to import |
| `pmImportDo` | 가져오기 | Import |
| `pmImportOkLine('가벼운 요약')` | 가져올 프리셋: 가벼운 요약 | Preset to import: 가벼운 요약 |
| `pmImportBroken` | 파일을 읽지 못했어요 · 깨진 파일 같아요 | Could not read the file · it looks broken |
| `pmImportForeign` | 프리셋 파일이 아니에요 · 이 파일은 가져오지 않아요 | This is not a preset file · it will not be imported |
| `pmImported` | 프리셋을 가져왔어요 | Preset imported |
| `pmDelT` | 프리셋을 지울까요? | Delete this preset? |
| `pmDelBody` | 지운 뒤에도 바로 되돌릴 수 있어요 | You can undo it right after |
| `pmDelDo` | 지우기 | Delete |
| `pmDeleted` | 프리셋을 지웠어요 | Preset deleted |
| `pmChosen` | 프리셋을 바꿨어요 | Preset changed |
| `pmSame` | 이미 쓰고 있는 프리셋이에요 | This preset is already in use |
| `pmSumAria('밤 이야기')` | 프리셋 요약: 밤 이야기 | Preset summary: 밤 이야기 |
| `pmSumRatio(20)` | 기억 비율 20% | Memory ratio 20% |
| `pmSumShares(40,40,20)` | 최근 40% · 비슷한 40% · 무작위 20% | Recent 40% · similar 40% · random 20% |
| `pmSumModel('Claude Sonnet 4.5')` | 요약 모델: Claude Sonnet 4.5 | Summary model: Claude Sonnet 4.5 |
| `pedActive` | 지금 쓰고 있는 프리셋이에요 | This preset is in use |
| `pedNotActive` | 아직 쓰고 있지 않은 프리셋이에요 · 고쳐도 쓰는 프리셋은 그대로예요 | This preset is not in use yet · editing it does not change the one in use |
| `pedUse` | 이 프리셋 쓰기 | Use this preset |
| `pedUsed` | 쓰는 중 | In use |
| `pedResetAll` | 프리셋 전체 기본값으로 | Reset the whole preset |
| `pedResetDone` | 프리셋을 기본값으로 되돌렸어요 | Preset reset to its defaults |
| `pedResetNone` | 이미 모두 기본값이에요 | Everything is already at its default |
| `pedSumSec` | 요약 | Summaries |
| `pedRatioSec` | 기억 비율 | Memory ratio |
| `pedAdvSec` | 고급 | Advanced |
| `pedAdvSum` | 고급 설정 보기 | Show advanced settings |
| `pedSepHelpA` | 줄바꿈은 | Write a line break as |
| `pedSepHelpB` | 처럼 적어요 · 지금 값: |  · current value: |
| `ratTitle` | 기억을 나누는 몫 | How memory is shared |
| `ratRecent(40)` | 최근 40% | Recent 40% |
| `ratSimilar(40)` | 비슷한 40% | Similar 40% |
| `ratRandom(20)` | 무작위 20% | Random 20% |
| `ratRemain(20)` | 무작위 20% (남는 몫) | Random 20% (the rest) |
| `ratVtRecent` | 최근 | Recent |
| `ratVtSimilar` | 비슷한 | Similar |
| `ratClamped(60)` | 합이 100%를 넘지 않게 60%로 맞췄어요 | Kept the total at 100%: set to 60% |
| `maxTitle` | 최대 기억 비율 | Max memory ratio |
| `maxNone` | 캐릭터를 고르면 계산해요 | Choose a character to calculate it |
| `maxHave('세라핀')` | 계산한 캐릭터: 세라핀 | Calculated for: 세라핀 |
| **Copy: Voice** | | |
| `vcNoVoiceTab` | 목소리 설정은 아직 Studio에 없어요 · 캐릭터만 열려요 | Voice settings are not in Studio yet · only the character opens |
| `vsTitle` | 목소리 서비스 | Voice services |
| `vsListedTitle` | 그 밖의 목소리 | Other voices |
| `vsListedNote` | 이 목소리들은 캐릭터에서 고르거나, 따로 설정할 게 없어요 | These voices are chosen in the character, or need no setup |
| `vsEleven` | 모델은 multilingual v2로 고정돼 있어요 | The model is fixed to multilingual v2 |
| `vsVoicevox` | VOICEVOX는 일본어로 번역해서 읽어요 · 번역 설정을 써요 | VOICEVOX reads in Japanese: it translates first, using the translation settings |
| `vsVoicevoxTr('한국어 · AI 모델')` | 지금 번역: 한국어 · AI 모델 | Translation now: 한국어 · AI 모델 |
| `vsVoicevoxGo` | 번역 설정 열기 | Open translation settings |
| `vsOpenai` | 채팅과 같은 OpenAI 연결을 써요 · 캐릭터마다 다른 주소를 쓸 수 있어요 (Studio) | Uses the same OpenAI connection as chat · a character can use its own address (Studio) |
| `vsHf` | 영어가 아닌 언어는 번역 설정을 써요 · 모델이 자고 있으면 깨우는 데 최대 30초 걸려요 | Languages other than English use the translation settings · a sleeping model can take up to 30 s to wake |
| `listBrowser` | 브라우저 음성 | Browser voice |
| `listVits` | VITS | VITS |
| `listSovits` | GPT-SoVITS | GPT-SoVITS |
| `vcTitle` | 캐릭터 목소리 | Character voices |
| `vcSummary(3,4)` | 4명 중 3명이 목소리를 써요 | 3 of 4 characters have a voice |
| `vcIntro` | 목소리는 캐릭터마다 정해요 · 바꾸려면 Studio에서 열어요 | A voice is chosen per character · open Studio to change it |
| `vcVoice('ElevenLabs','Rachel')` | ElevenLabs · Rachel | ElevenLabs · Rachel |
| `vcAuto` | 자동 | Automatic |
| `vcNone` | 목소리 없음 | No voice |
| `vcQuote` | 따옴표 안만 읽기 | Quoted text only |
| `vcStudio` | Studio에서 바꾸기 | Change in Studio |
| `vcStudioOf('세라핀')` | Studio에서 바꾸기: 세라핀 | Change in Studio: 세라핀 |
| `vcNote` | 엔진, 목소리, 속도, 따옴표 안만 읽기는 캐릭터마다 Studio에서 정해요 | Engine, voice, speed and quoted-text-only are set per character in Studio |
| **Copy: Emotion images** | | |
| `emoPromptNote` | 캐릭터가 자기 감정 지침을 더할 수도 있어요 · Studio에서 바꿔요 | A character may add its own emotion instructions · change them in Studio |
| `emoLegend` | 감정을 고르는 방식 | How the emotion is chosen |
| `emoModelL` | 감정 모델이 골라요 | The emotion model chooses |
| `emoModelD` | 모델 페이지의 감정 모델에게 짧게 물어봐요 · 요청이 하나 더 가요 | Asks the emotion model of the Models page a short question · one more request |
| `emoModelIs('GPT-5 mini')` | 감정 모델: GPT-5 mini | Emotion model: GPT-5 mini |
| `emoModelGo` | 모델 페이지에서 바꾸기 | Change on the Models page |
| `emoEmbL` | 문장 비슷함으로 골라요 | Chosen by how similar the text is |
| `emoEmbD` | 요청 없이 기기에서 계산해요 | Calculated on this device, no request |
| `emoPromptDim` | 감정 모델이 고를 때만 쓰여요 · 방식을 바꾸면 고칠 수 있어요 | Only used when the emotion model chooses · switch the method to edit it |
| `dimBlocked` | 이 칸은 지금 고칠 수 없어요 · 방식을 감정 모델로 바꾸면 고칠 수 있어요 | This field cannot be edited now · switch the method to the emotion model to edit it |
| `emoPerChar` | 감정 이미지는 캐릭터마다 정해요 | Emotion images are set per character |
| `emoNames('세라핀')` | 감정 이름 · 세라핀 | Emotion names · 세라핀 |
| `emoStudio` | Studio에서 열기 | Open in Studio |
| `emoStudioOf('세라핀')` | Studio에서 열기: 세라핀 | Open in Studio: 세라핀 |
| `noChar` | 캐릭터를 고르면 보여 줘요 | Choose a character to see it |
| `emoNoChar` | 캐릭터를 고르면 Studio에서 열 수 있어요 | Choose a character to open it in Studio |
| **Copy: Image generation** | | |
| `igLegend` | 이미지 생성 서비스 | Image generation service |
| `igOff` | 끄기 | Off |
| `igOffD` | 이미지를 만들지 않아요 | No images are made |
| `igCost` | 이미지 하나에 보조 모델 요청 1번 + 서비스 요청 1번 | Each image costs one request to the sub model and one to the service |
| `igFieldsOf('WaveSpeed')` | WaveSpeed 설정 | WaveSpeed settings |
| `igAddr` | 주소 | Address |
| `igAddrKey` | 주소 + 키 | Address + key |
| `igKey` | 키 | Key |
| `igListed` | 이번 시안에는 필드 이름만 나와요: | This mockup lists the field names only: |
| `igSubNote` | 이 서비스의 설정이에요 | The settings of this service |
| `igFieldsNai` | 주소, 키, 모델, 크기, 샘플러, 노이즈 스케줄, 단계, 스케일, CFG 보정, 참고 이미지(바이브/캐릭터), SMEA, DYN, Variety+, Decrisp, 이미지로 이미지 | address, key, model, size, sampler, noise schedule, steps, scale, CFG rescale, reference (vibe/character), SMEA, DYN, Variety+, Decrisp, image to image |
| `igFieldsDalle` | 키, 품질(표준/HD) | key, quality (standard/HD) |
| `igFieldsStab` | 키, 모델(ultra, core, sd3-large, sd3-medium), core 스타일 | key, model (ultra, core, sd3-large, sd3-medium), core style |
| `igFieldsFal` | 키, 크기, 모델, LoRA 주소와 세기 | key, size, model, LoRA address and strength |
| `igFieldsComfy` | 주소, 워크플로, 제한 시간(1–120초) | address, workflow, timeout (1–120 s) |
| `igFieldsImagen` | 키, 모델, 이미지 크기(1K/2K), 가로세로 비율, 사람 생성 | key, model, image size (1K/2K), aspect ratio, person generation |
| `igFieldsComfyOld` | 주소, 워크플로, 제한 시간, 긍정/부정 프롬프트 노드 번호와 필드 이름 | address, workflow, timeout, positive/negative prompt node numbers and field names |
| `sdCustom` | 직접 입력 | Type your own |
| `sdBlank` | 샘플러 이름을 비울 수 없어요 · 이전 값을 그대로 뒀어요 | The sampler name cannot be blank · the previous value was kept |
| `sdCustomL` | 샘플러 이름 | Sampler name |
| `sdSamplerD` | 자주 쓰는 샘플러를 고르거나 직접 입력해요 | Pick a common sampler or type your own |
| `sdHiresSum` | 고해상도 보정 (선택) | Hires fix (optional) |
| `sdApi` | WebUI를 --api 옵션으로 실행해야 연결돼요 | Start WebUI with the --api option so it can connect |
| `sdLicense` | WebUI는 AGPL 라이선스예요 · 이 앱에 들어 있지 않아요 | WebUI is under the AGPL licence · it is not bundled with this app |
| `sdTunnel` | 웹 버전에서는 내 PC의 WebUI에 닿으려면 터널이 필요해요 | On the web build you need a tunnel to reach the WebUI on your PC |
| `pvTitle` | 프롬프트 (캐릭터마다 정해요) | Prompt (set per character) |
| `pvOf('세라핀')` | 프롬프트 · 세라핀 | Prompt · 세라핀 |
| `pvPrefix` | 앞에 붙는 말 | Added in front |
| `pvNegative` | 빼는 말 | Left out |
| `pvStudio` | Studio에서 바꾸기 | Change in Studio |
| `pvStudioOf('세라핀')` | Studio에서 바꾸기: 세라핀 | Change in Studio: 세라핀 |
| `wsSearch` | 모델 검색 | Search models |
| `wsRefresh` | 모델 목록 새로 불러오기 | Reload the model list |
| `wsListAria` | WaveSpeed 모델 | WaveSpeed models |
| `wsLoading` | 모델 목록을 불러오는 중이에요… | Loading the model list… |
| `wsFail` | 목록을 불러오지 못했어요 · 키와 네트워크를 확인하세요 | Could not load the list · check the key and the network |
| `wsEmpty` | 불러온 모델이 없어요 | No models were found |
| `wsNever` | 아직 목록을 불러오지 않았어요 · 새로고침을 눌러 주세요 | The list has not been loaded yet · press reload |
| `wsNoMatch('zzz')` | 맞는 모델이 없어요: zzz | No matching model: zzz |
| `wsCount(1,7)` | 모델 7개 중 1개 | 1 of 7 models |
| `wsLoaded(7)` | 모델 7개를 불러왔어요 | Loaded 7 models |
| `wsLora` | LoRA | LoRA |
| `wsRef` | 참고 이미지 | Reference image |
| `wsYes` | 지원 | supported |
| `wsNo` | 지원 안 함 | not supported |
| `wsChosen('Flux Dev','$0.0040')` | 고른 모델: Flux Dev · $0.0040 | Chosen model: Flux Dev · $0.0040 |
| `wsChosenNoPrice('Imagen 4')` | 고른 모델: Imagen 4 | Chosen model: Imagen 4 |
| `wsNone` | 모델을 아직 고르지 않았어요 | No model chosen yet |
| `wsPicked` | 모델을 골랐어요 | Model chosen |
| `wsNoLora` | 이 모델은 LoRA를 지원하지 않아요 | This model does not support LoRA |
| `wsNoRef` | 이 모델은 참고 이미지를 지원하지 않아요 | This model does not support a reference image |
| `loraTitle` | LoRA (최대 3개) | LoRA (up to 3) |
| `loraUrl(1)` | LoRA 1 주소 | LoRA 1 address |
| `loraUrlPh` | LoRA 주소 | LoRA address |
| `loraScale(1)` | LoRA 1 세기 | LoRA 1 strength |
| `loraDel(1)` | LoRA 1 지우기 | Remove LoRA 1 |
| `loraAdd` | LoRA 추가 | Add LoRA |
| `loraMax(2)` | 2/3개 | 2/3 |
| `loraFull` | LoRA는 3개까지 쓸 수 있어요 | You can use up to 3 LoRAs |
| `loraAdded(2)` | LoRA 2개 | 2 LoRA |
| `loraRemoved` | LoRA를 지웠어요 | LoRA removed |
| **Copy: Translation** | | |
| `googleOnly` | Google에서만 | Google only |
| `googleOnlyWarn` | 이 언어는 Google에서만 번역돼요 · 다른 방식에서는 번역되지 않아요 | This language is only translated by Google · the other methods will not translate it |
| `trTypeLegend` | 번역 방식 | Translation method |
| `ttGoogle` | 무료 · 공개 주소를 써요 | Free · uses a public address |
| `ttDeepl` | 키가 필요해요 · 연결에서 키를 관리해요 | Needs a key · the key is managed under Connections |
| `ttDeeplx` | 주소와 토큰이 필요해요 · 연결에서 관리해요 | Needs an address and a token · managed under Connections |
| `ttLlm` | 번역 모델에게 맡겨요 · 프리셋으로 말투를 정해요 | Leaves it to the translation model · presets set the tone |
| `ttLocal` | 기기에서 번역해요 · 처음 쓸 때 모델을 내려받아요 | Translates on this device · downloads a model the first time |
| `ttLlmN` | AI 모델 | AI model |
| `ttLocalN` | 기기에서 번역 (Firefox 엔진) | On this device (Firefox engine) |
| `deeplWeb` | 웹 버전에서는 DeepL에 직접 닿지 못할 수 있어요 · 프록시가 필요해요 | On the web build DeepL may not be reachable directly · a proxy is needed |
| `srcNote` | 원문 언어는 Google에서만 고를 수 있어요 | The source language can only be chosen with Google |
| `trOffNote` | 번역이 꺼져 있어요 · 언어를 고르면 방식을 정할 수 있어요 | Translation is off · choose a language to pick a method |
| `trModelIs('Claude Haiku 4.5')` | 번역 모델: Claude Haiku 4.5 | Translation model: Claude Haiku 4.5 |
| `trModelGo` | 모델 페이지에서 바꾸기 | Change on the Models page |
| `trPresetTitle` | AI 번역 프리셋 | AI translation presets |
| `trPromptDefault` | (기본 프롬프트) | (default prompt) |
| `trMaxIs(1000)` | 최대 응답 1000 | Max response 1000 |
| `trSum('한국어','AI 모델')` | 한국어 · AI 모델 | 한국어 · AI 모델 |
| `trSumOff` | 번역이 꺼져 있어요 | Translation is off |
| `trLinkT` | 번역은 언어 페이지에서 설정해요 | Translation is set on the Language page |
| `trLinkGo` | 언어에서 열기 | Open in Language |
| `trVoicevox` | 음성: VOICEVOX가 이 번역을 써요 | Voice: VOICEVOX uses this translation |
| `trVoicevoxGo` | 음성 설정 열기 | Open voice settings |
| `trTestTitle` | 번역 테스트 | Translation test |
| `trSample` | 샘플 문장: “Hello, nice to meet you.” | Sample sentence: “Hello, nice to meet you.” |
| `trpTitle` | 프롬프트와 길이 | Prompt and length |
| `trpSlot` | {{slot}}은 번역할 언어로 바뀌어요 | {{slot}} becomes the language to translate into |
| `cacheTitle` | 번역 캐시 | Translation cache |
| `cacheCount('1,284')` | 저장된 번역 1,284개 | 1,284 saved translations |
| `cacheExport` | 내보내기 | Export |
| `cacheImport` | 가져오기 | Import |
| `cacheClear` | 비우기 | Clear |
| `cacheNa` | 번역 캐시는 AI 모델 방식에만 있어요 | The translation cache only exists for the AI model method |
| `cacheEmpty` | 캐시가 비어 있어요 | The cache is empty |
| `cacheExported('1,284')` | 번역 1,284개를 내보냈어요 | Exported 1,284 translations |
| `cacheImportT` | 번역 캐시 가져오기 | Import a translation cache |
| `cacheImportBody` | 가져오면 지금 캐시에 합쳐져요 | It is merged into the current cache |
| `cacheImportDo` | 가져오기 | Import |
| `cacheImportOk('312')` | 번역 312개를 합쳐요 | Merges 312 translations |
| `cacheImportBad` | 캐시 파일이 아니에요 | This is not a cache file |
| `cacheImported('312')` | 번역 312개를 가져왔어요 | Imported 312 translations |
| `cacheClearT` | 번역 캐시를 비울까요? | Clear the translation cache? |
| `cacheClearBody('1,284')` | 저장된 번역 1,284개가 지워져요 · 10초 안에는 되돌릴 수 있어요 | 1,284 saved translations will be removed · you can undo within 10 seconds |
| `cacheClearDo` | 비우기 | Clear |
| `cacheCleared('1,284')` | 번역 1,284개를 비웠어요 | Cleared 1,284 translations |
| `cacheGone` | 10초가 지나서 되돌릴 수 없어요 | More than 10 seconds have passed, so it cannot be undone |
| `srchMemPreset` | HypaMemory V3 프리셋 | HypaMemory V3 preset |
| `srchTrPreset` | AI 번역 프리셋 | AI translation preset |
| `srchVoice` | 음성 서비스 | Voice service |
| `srchImg` | 이미지 생성 서비스 | Image generation service |
| `srchTrType` | 번역 방식 | Translation method |
| **Copy: Models page** | | |
| `embWarn` | 저장된 기억을 다시 만들어야 할 수 있어요 | Memories already stored may need to be rebuilt |
| `embCpu` | 이 기기 (CPU) | On this device (CPU) |
| `embGpu` | 이 기기 (GPU · WebGPU) | On this device (GPU · WebGPU) |
| `embHosted` | 호스팅 서비스 | Hosted services |
| `embCustom` | 직접 지정 | Custom |
| `embShared` | 장기 기억과 감정 이미지(문장 비슷함 방식)가 같이 써요 · 여기서 바꾸면 둘 다 바뀌어요 | Long-term memory and emotion images (similarity method) share it · changing it here changes both |
| **Copy: Sub-pages, search, demo** | | |
| `title` | 설정 슬라이스 5b · 대화 기능, 번역, 임베딩 목업 | Settings slice 5b · chat features, translation, embedding mockup |
| `undo` | 되돌리기 | Undo |
| `cancel` | 취소 | Cancel |
| `close` | 닫기 | Close |
| `phDefault` | 비워 두면 기본 프롬프트를 써요 | Blank uses the built-in prompt |
| `demoPending` | 목업 표시 · Lane A 확인 대기 | Mockup mark · waiting for Lane A |
| `demoSim` | 이 목업에서 테스트, 목록 가져오기, 내려받기는 시뮬레이션이에요 | In this mockup tests, list fetches and downloads are simulated |
| `backMem` | 장기 기억으로 돌아가기 | Back to long-term memory |
| `backMemS` | 장기 기억 | Long-term memory |
| `backVoice` | 음성으로 돌아가기 | Back to voice |
| `backVoiceS` | 음성 | Voice |
| `backImg` | 이미지 생성으로 돌아가기 | Back to image generation |
| `backImgS` | 이미지 생성 | Image generation |
| `backTr` | 번역으로 돌아가기 | Back to translation |
| `backTrS` | 번역 | Translation |
| `grpItem` | 프리셋·서비스 | Presets and services |
| `demo5b` | 대화 기능 데모 | Chat features demo |
| `demoSet` | 데이터 세트 | Data set |
| `setDemo` | 기본 | Default |
| `setLegacy` | 이전 방식 중심 | Older methods |
| `setFailing` | 모두 실패 | Everything fails |
| `setEmpty` | 빈 상태 | Empty |
| `demoGpu` | WebGPU 있음 | Has WebGPU |
| `demoChar` | 캐릭터 고르기 | A character is chosen |
| `demoWeb` | 웹 버전 | Web build |
| `demoAllFail` | 모든 테스트 실패 | Every test fails |
| `demoHf` | Hugging Face 503 | Hugging Face 503 |
| `demoWsFetch` | WaveSpeed 목록 불러오기 | WaveSpeed list fetch |
| `demoState` | 상태 | State |
| `demoGo` | 열기 | Open |

## 10. The mockup

### 10.1 Files

- **New files:** `settings/slice5b.html`, `slice5b.css`, `slice5b.js` and `data5b.js`.
- **Loading:** they load slices 1–5a and extend them through `window.SS1_EXT` and the existing hooks.
- **Pages this slice changes:** 대화 기능, 언어 › 번역, 모델 › 임베딩, and the 고급 emotion row's removal.
- **Earlier slices:**
  - Slice 1's catalog is corrected **in slice5b's data layer**. Slice 1–5a pages keep their own data, so their suites stay green.
  - If slice 1–5a files get hooks, **ss1–ss5a, th, th4 and th5a stay green**.
- **Data:** synthetic only, with no network. Tests, fetches and downloads are simulated with failure toggles.

### 10.2 Fixtures (`?set=`)

| Set | Contents |
|---|---|
| `demo` | **Memory:** HypaV3 with 3 presets ("기본", "빠른 요약", "긴 이야기용"; one with experimental options).<br>**Embedding:** Multilingual MiniLM L12 v2 (CPU).<br>**Voice:** auto on; ElevenLabs via `${ELEVEN_KEY}`; a VOICEVOX address; Fish missing; 4 characters' voices.<br>**Emotion:** the 감정 모델 method, 8 emotions.<br>**Image generation:** WebUI.<br>**Translation:** ko via AI 모델, 3 presets, cache 1,284. |
| `legacy` | Supa with instruct35 and no OpenAI connection; legacy `comfy` selected; translation via Firefox. |
| `failing` | Every test fails; the WaveSpeed fetch fails; the VOICEVOX address is unreachable. |
| `empty` | Memory off, no connections, image generation off, translation off. |

### 10.3 States (`?state=`)

- **장기 기억:** `me-engines`, `me-switch-undo`, `me-v3-preset`, `me-preset-menu`, `me-preset-editor`, `me-ratio-clamp`, `me-experimental`, `me-supa-needs-key`.
- **음성:** `vo-list`, `vo-test`, `vo-test-fail`, `vo-voices`, `vo-voicevox-translate`.
- **감정 이미지:** `em-model`, `em-embedding`.
- **이미지 생성:** `ig-list`, `ig-webui`, `ig-openai`, `ig-wavespeed`, `ig-wavespeed-fail`, `ig-test`, `ig-legacy-comfy`, `ig-prompt-nochar`.
- **번역:** `tr-ai`, `tr-google`, `tr-deeplx`, `tr-firefox`, `tr-preset`, `tr-cache-clear`, `tr-test`.
- **모델:** `mo-embedding`, `mo-embedding-warn` (the stale-memory warning after a change, DS-141), `mo-embedding-nosize` (a model with no download size: no number, DS-147).
- **Search:** `se-hypa` (`q=hypaV3`), `se-sampler`, `se-emotionprompt` (finds it in 대화 기능, not 고급).
- **Parameters:** slice 1's. The page sets `window.__ss5bReady` and exposes `window.__ss5b`.

### 10.4 Checks

Suites `ss5b` and `th5b` in `settings/checks/` (`ss5b/`, `th5b/`, `th5b/registry5b.mjs`), in slice 5a's shape:
- about 90 s at 3 workers, at most 3 Chrome workers;
- own profiles, deleted afterwards;
- never stop 6141;
- a distinct `--tag` and a log per final run;
- `.timing.json` with `slowest5`;
- KO and EN at 360 / 412 / 768 / 1024 / 1280.

| Section | Covers |
|---|---|
| memory | Engine radios, the sentences and markers, the switch writes all derived fields, and undo restores them; per-engine fields and defaults; the summary-model label; the embedding line links to 모델 |
| preset | Preset bar actions (new with a name, 복제, rename, export/import incl. foreign file, delete with undo, last-preset guard); editor ratios clamp (0 included); max ratio without a character; experimental gating |
| voice | Auto-play, service rows with connection chips and the missing state, worked services, listed-only services, test success and failures, the voices list and its Studio links, the VOICEVOX translation note |
| emotion | Two methods, the shared-embedding line, the prompt moved (absent from 고급, found by search), dimmed under embedding with explain-only |
| imggen | Provider list (legacy only when selected), cost line, worked services' fields, ranges and the sampler list, WaveSpeed fetch/search/fail/LoRA/reference, listed-only providers, read-only prompt with the Studio link and no-character state, test |
| translate | Type radios and plain labels, type-gated fields with reasons, Google-only items, preset bar, cache LLM-only with the reason, clear with confirm and undo, test |
| models | The 임베딩 row on 모델, its options and the device-gated GPU group, shared note |
| catalog | Every DS-132 row is absent from 대화 기능 and from search; every real field is findable |
| store | `__ss5b.storeWrite` reflected; no stale copies |
| a11y/modes | Roles and names, Back order, reduced motion and low power, forced colours, 200 % text, 44 dp |
| th5b | New parts and critical marks, rendered contrast and ring in the three looks, pack lint over the new names (DD-195 units for any floor) |
| koen, stills, console | As slice 5a |
| regression | ss1–ss5a, th, th4 and th5a if their files changed |

## 11. Open questions

- **O-1 (answered, DS-145):** no new setting. The page explains the per-chat toggle and the HypaV3 preset's "always turn on".
- **O-2 (answered, DS-141):** the 임베딩 row warns on change that stored memories may need rebuilding. **Pending Lane A confirmation** that stored vectors do go stale; the mockup marks the warning "pending" and the warning ships only when confirmed.
- **O-3 (answered, DS-146):** keep the global prompt with a note that a character may add its own instructions. Lane A checks both paths (`emotionPrompt2` and `newGenData.emotionInstructions`) at integration.
- **O-4 (answered, DS-143):** Studio has no voice kind. A voice kind is **requested from the Studio lane** (through the main session). Until it exists the voice rows open the character in Studio with no `kind`, and the page says voice settings are not in Studio yet.

## 12. Design defaults to confirm

- The "권장" chip on HypaV3.
- Cost and download lines.
- The ratio bar.
- The WebUI sampler list with 직접 입력.
- Inline service fields on wide screens versus a sub-page on phones.
- Source language hidden for non-Google types.
- Translation-cache clear with undo.
- The test phrases.

## Build notes (builder, 2026-10-28)

What was built, and where it differs from the text above. DS-127 to DS-147 are honoured (DS-141 to DS-147 came from the independent review, `reviews/slice5b-review.md`, and are applied in fix round 1); the deviations are listed in `checks/builder-checks-ss5b.md`.

- **Files:** `slice5b.html`, `slice5b.css` (9 `--p5b-*` tokens), `slice5b.js` (hooks on `SS1_EXT`, loaded after `slice5a.js`), `data5b.js` (rows, fixtures, 4 sets, about 330 copy keys). Slice 1's invented rows are removed only from 5b's own data (DS-132); slices 1 to 5a keep their pages and stay green. Slice 1 to 5a files are not edited; the one shared edit is `themes/banana-cocoa.css` (rules for the slice 5b parts, listed in `th5b/tokens.mjs`; the darker field border is scoped to the preset select and the model list, so the earlier slices keep their borders).
- **Store first (DS-067):** every outside write goes through `__ss5b.storeWrite`, and the page re-reads the store; the view state holds only what is open.
- **States:** 36, in the names of §10.3. `?state=` runs one; `__ss5b.runState` runs another after load; `__ss5bReady` holds the state name.
- **Assumptions the builder made** (not decided by a DS entry): the voice test speaks "안녕하세요, 목소리 테스트예요" (KO) or "Hello, this is a voice test" (EN) and the translation test translates "Hello, nice to meet you." (the earlier note had them the wrong way round, R5B-9); DS-138's "experimental" is the preset's `useExperimentalImpl` (confirmed, DS-142); the ratio bar is read-only, the two number fields write; the derived value written to `memoryAlgorithmType` is synthetic; Studio's kind for the emotion and prompt links is `display` (Studio slice 4 holds them in the Screen sub-tab) and the voice links carry no kind (DS-143); number fields validate while typing and commit on change.

### Integration notes

For the main session and Lane A. None of these changes a decision; they are what the mockup leaves open.

- **DS-141 ships only after Lane A confirms.** The 임베딩 row warns after a change that stored memories may need rebuilding. That is only true if stored vectors do go stale; Lane A confirms it first. The mockup shows the warning with a separate demo-only mark ("목업 표시 · Lane A 확인 대기", outside the `settings-notice` part); the mark is not product copy and is not integrated.
- **R5B-10, the single-preset guard.** `settings-preset-guard` (critical, with a warning icon) shows whenever one preset exists, which is every fresh install. It reads as a warning when nothing is wrong. At integration make it a neutral info line next to the disabled 삭제 and give the disabled menu item `aria-describedby` to it; this changes a critical part, so its th5b fixtures change with it.
- **R5B-13, double announcements.** A test's status line is `role=status` and `runTest` also calls `announce()`. Keep one of the two after a screen-reader pass; not verified here.
- **R5B-14, copy.** The embedding line is three fragments (`memEmbA`, `memEmbGo`, `memEmbB`) that read out of order in translation and wrap with an orphan on a phone: make it one sentence with a link slot. With HypaV3 the summary line and the memory-model line repeat each other: keep one. Only `resetDone` was reworded.
- **Hugging Face 503.** The mockup shows the warm-up as a finished failure; the app waits and retries for up to 30 s (research §2.2). Integrate it as a running state with a countdown and a cancel.
- **DD-195 ceilings.** Only the floor of `--p5b-bar` is in the registry. The size tokens (`--p5b-list-max`, `--p5b-rbar-h`, `--p5b-tile`) have no ceiling; a pack that sets a very large value could push the model list's controls off screen. Decide ceilings when `MINIMUMS5B` is lifted into `packlint-settings.mjs`.
- **R5B-15, number bounds (done).** Number fields carry only the bounds the source has: a minimum for the chunk, token, chats-per-summary and per-minute fields (no maximum), 1 to 10 for concurrency, 1 to 20 for the query chat count, and the WebUI and translation ranges of research §4.1 and §5.1. `FX-R5B15-number-bounds` holds the table.
- **Defaults, sizes and prices come from data** (5b-13, 5b-14), a **voice kind** is requested from the Studio lane (5b-9), and Lane A checks both emotion-prompt paths (5b-15).

### Engine items

- **5b-1:** the memory engine is one stored choice. The mockup's `memoryEngine` stands for the five fields `hypaV3`, `hypav2`, `supaModelType`, `hanuraiEnable` and `memoryAlgorithmType`. The switch writes them together and one undo restores them. Existing chats and exports with the old fields must migrate both ways.
- **5b-2:** HypaV3 presets are addressed by id (`hypaV3Presets`, `hypaV3PresetsIndex`). New asks a name, 복제 is new, the last preset cannot be deleted, and import refuses a foreign or broken file with a message (today the app silently ignores it; R5B-8). The editor's ratio fields are clamped live, 0 included.
- **5b-3:** the embedding model is a shared setting on the Models page (`hypaModel`). The memory page and the emotion page show it as a line with a link. A change warns that stored memories may need rebuilding (DS-141, **pending Lane A confirmation** that vectors go stale).
- **5b-4:** service connections. Voice, image and translation services get provider entries in the connection add (`fishKey`, `hfKey`, `stabilityKey`, `falKey`, `voyageKey`), and a row refers to a connection instead of holding a key. Fish Audio has a key and a fixed host, so it has no address row (R5B-7). `supaMemoryKey` and `voyageApiKey` become references; the main session migrates the stored values.
- **5b-5:** the emotion prompt moves from 고급 to 감정 이미지. Slice 1's catalog never listed it on 고급 in 5b's data layer; the page that kept it there is slice 1's own. It is explain-only and dimmed under the embedding method (DS-096).
- **5b-6:** image generation has one schema per service. The WebUI sampler is a list with 직접 입력. WaveSpeed is a listbox with search, keyboard type-ahead, price and two support marks. LoRA rows and the Hires fix disclosure are real fields. Legacy ComfyUI shows only when selected, with the legacy mark.
- **5b-7:** test actions are new app work: a test per voice service, per image service and per translation method, with the failure codes nokey, noaddr, unreachable, badkey, timeout, warming and nomodel, a cancel, and a polite status line.
- **5b-8:** the translator shows plain labels instead of internal names, hides the source language for non-Google types with a reason, shows Google-only items only for Google, and offers the cache tools only for the AI method; clear has a confirm and an undo.
- **5b-9:** Studio needs a **voice kind** for a character's voice: it is requested from the Studio lane (DS-143), and the voice links carry no kind until it exists. The emotion images and the prompt prefix are in the `display` kind (Studio slice 4). The return map for a `character` owner opened from Settings must lead back to the same row.
- **5b-10:** catalog removals (DS-132): the rows that slice 1 invented and that the app does not have are absent from 대화 기능 and from search in 5b's data layer. The integration deletes them from the real catalog, and the search index follows.
- **5b-11:** test behaviour (DS-144): the voice test names the voice it uses (the active character's on that engine, else the first character that uses it, else the service's default); a test that can cost money (voice: all but VOICEVOX; image: all but WebUI and ComfyUI; translation: AI model, and DeepL unless the free plan is on) shows "요금이 나갈 수 있어요" before it runs, with no confirm; "(시뮬레이션)" is not product copy (a separate demo-only note in the demo panel says tests are simulated). A VOICEVOX test also calls the translator first when the line is not Japanese (research §2.2).
- **5b-12:** failures fit the service (R5B-3): Google says it could not reach the translation server, the AI model says no translation model is set, the on-device engine says the download failed; only DeepL, DeepLX and the voice and image services can miss a key or an address.
- **5b-13:** numbers (DS-147): download sizes and prices come from model data or provider info at integration; where a number is unknown none is shown (the mockup has a model with no size, a WaveSpeed model with no price and an image service with no cost). The sizes and prices in the fixtures are synthetic.
- **5b-14:** defaults (R5B-2): the WebUI defaults are the app's own (`database.svelte.ts`): steps 30, CFG 7, width and height 512, sampler Euler a, denoising strength 0.7, hires scale 1.25, upscaler Latent. The integration takes every default from the database and never from the mockup. A blank prompt shows "비워 두면 기본 프롬프트를 써요" and no invented prompt text.
- **5b-15:** the emotion prompt (DS-146): the global prompt stays, with a note that a character may add its own; Lane A checks both paths (`emotionPrompt2` and `newGenData.emotionInstructions`) at integration.

## Appendix: Parts (theme readiness, DD-142 to DD-161)

Filled by the builder (2026-10-28) from `slice5b.js`; `checks/th5b/parts.mjs` reads this table and fails if the pages carry a name that is not listed here or in the slice 1 to 5a appendices, if an element carrying a name does not match the Selector, if a main element class carries no part, or if a name is never seen. Slice 5b adds **34 names** (9 critical, 6 safe, 19 reach); the pages also use `settings-section`, `-rows`, `-row`, `-row-label`, `-row-description`, `-field`, `-segmented`, `-toggle`, `-page-body`, `-page-header`, `-section-title`, `-jump-chips`, `-warning-banner`, `-button`, `-model-group` and the dialog and menu parts of slices 1 to 3. Rows marked **critical** carry `data-part-critical`: a pack cannot name them, so cannot hide or recolour them. **Safe** leaves are never critical, never hold a critical element and never sit inside one (a pack may hide them: the row or the critical part beside them carries what they repeat). **Reach** parts hold critical parts or controls with no other way: a pack may restyle them but not hide them. The test result of a connection (`settings-test-result`, slice 3) is a different part from the result of a voice, image or translation test here (`settings-service-test-result`): the two have different selectors and the first is documented in slice 3.

| Part | Selector | Notes |
|---|---|---|
| `settings-choice-list` | `.p5b-choices` | a radio group (a fieldset with its legend): the memory engines, the emotion method, the image services, the translation methods; reach |
| `settings-choice` | `.p5b-optw` | one option card (the radio, its name, its one sentence, its marks and what hangs under it); `data-current` (the checked option); reach |
| `settings-choice-recommended` | `.p5b-tag.rec` | the "권장" mark on HypaMemory V3; **safe** |
| `settings-choice-legacy` | `.p5b-tag.old` | the "이전 방식" mark on HypaMemory V2, SupaMemory and the legacy ComfyUI; a word with an icon; **critical** |
| `settings-service-chip` | `.p5b-conn:not(.missing)` | the reference chip "연결: {name}": a button that opens the connection; `data-state="ok"`; reach |
| `settings-service-missing` | `.p5b-conn.missing` | "연결 필요" (the 연결 추가 button sits beside it); `data-state="missing"`; **critical** |
| `settings-service-list` | `.p5b-svcs` | the voice services list and the list of listed-only voices; reach |
| `settings-service-row` | `.p5b-svc`, `.p5b-listed` | one voice service (name, what it needs, its note, the chip, the test); reach |
| `settings-service-fields` | `.p5b-fields` | the fields of the chosen image service, inline on wide screens and on its sub-page; reach |
| `settings-test-button` | `.p5b-test` | the 테스트 / 취소 button of a service or a translation method; reach |
| `settings-service-test-result` | `.p5b-tres` | the result of a test in a polite status line: running, success, a failure, cancelled; `data-state`, `data-code` (the failure); **critical** |
| `settings-preset-bar` | `.p5b-pbar` | the preset bar (label, the select-like button, 편집, ⋯) of the HypaV3 and the AI translation presets; reach |
| `settings-preset-summary` | `.p5b-psum` | the three-line summary of the active HypaV3 preset; **safe** |
| `settings-preset-guard` | `.p5b-guard` | "프리셋이 하나는 있어야 해요" under the bar of the last preset; **critical** |
| `settings-ratio-bar` | `.p5b-ratio` | the stacked bar of the three memory shares with its legend; **safe** |
| `settings-ratio-remainder` | `.p5b-remain` | the remainder (random) share in a polite status line, outside the bar so a pack that hides the bar keeps it (R5B-5); **critical** |
| `settings-cost-line` | `.p5b-cost` | the cost and download lines ("요약할 때 기억 모델로 요청을 더 보내요", "처음 쓸 때 모델을 내려받아요 (약 …)", with no number where the size is unknown, DS-147); **critical** |
| `settings-embedding-line` | `.p5b-embline` | "임베딩: … · 모델 페이지에서 바꿔요 · … 같이 써요"; **safe** |
| `settings-embedding-row` | `.p5b-emb` | the 임베딩 row on the Models page (the select with its groups, the connection chip, the shared note); reach |
| `settings-dim-reason` | `.p5b-reason` | the reason line of a dimmed row (the emotion prompt under the embedding method, DS-096) and the Google-only warning of the translator; **critical** |
| `settings-prompt-view` | `.p5b-pview` | the active character's prompt prefix and negative prompt, read-only, with the Studio link and the no-character state; `data-state="none"`; reach |
| `settings-studio-link` | `.p5b-studio` | a "Studio에서 …" link to a character (voice, emotion images, prompt); reach |
| `settings-link-card` | `.p5b-studiorow` | the emotion images' per-character card (the emotion names and the Studio link); reach |
| `settings-voice-list` | `.p5b-vlist` | the character voices list; reach |
| `settings-voice-row` | `.p5b-vrow` | one character's voice (name, engine · voice, "따옴표 안만 읽기", the Studio link); reach |
| `settings-model-list` | `.p5b-wlist` | the WaveSpeed model listbox; reach |
| `settings-model-option` | `.p5b-wopt` | one model option (name, price, two support marks as words); `data-current` (the chosen one), `data-active` (the keyboard cursor); reach |
| `settings-lora-list` | `.p5b-lora` | the LoRA rows (address, strength, remove) and 추가; reach |
| `settings-cache-block` | `.p5b-cache` | the translation cache tools, or the reason there are none; `data-state` on / na; reach |
| `settings-note` | `.p5b-note:not(.p5b-embshared):not(.p5b-embwarn)`, `.p5b-listednote` | decorative one-line notes (the field names of a listed service, the no-LoRA and no-reference lines, the emotion prompt note, the voices note); **safe** |
| `settings-notice` | `.p5b-cache-note`, `.p5b-embshared`, `.p5b-embwarn`, `.p5b-tvoice`, `.p5b-paid` | notes that a decision mandates: the translation-cache reason (DS-139), the shared-embedding note (DS-137), the stale-memory warning (DS-141, marked pending), the voice a test uses and the paid warning (DS-144); **critical** |
| `settings-notes` | `.p5b-notes` | the WebUI notice list (`--api`, the licence, the tunnel); **critical** |
| `settings-disclosure` | `.p5b-details` | a collapsed group: the preset's 고급 and the Hires fix; reach |
| `settings-readout` | `.p5b-maxv` | the read-only max memory ratio value; **safe** |

Critical in this slice (`data-part-critical`):
- the method marks that tell a user what is old (`settings-choice-legacy`);
- what a service still needs and what a test found: the missing-connection state, the result of a test (a failure is never hidden) and the last-preset guard;
- why a row cannot be edited now (`settings-dim-reason`, DS-096);
- what a service or a model costs or downloads (`settings-cost-line`), the WebUI notices (`settings-notes`), the notices that decisions mandate (`settings-notice`: DS-137, DS-139, DS-141, DS-144) and the remainder share (`settings-ratio-remainder`) (R5B-5);
- every dialog with a danger button (`settings-dialog`, its backdrop and actions): the preset delete confirm, the cache clear confirm, and the undo toast of a delete (slice 2's critical kinds).

Why the safe leaves may be hidden: the "권장" mark is a suggestion, the preset summary repeats what the editor shows, the ratio bar repeats the legend's numbers and the two number fields (the remainder is a separate critical part), the embedding line repeats the Models page, the plain notes are explanations that the labels already carry, and the max ratio is a read-only calculation. The cost and download lines are not safe: the Models page does not repeat the sentences of the memory, voice and image pages. The option cards, the lists, the rows, the cache block and the fields hold controls with no other way, so they are reach tier: restyled, not hidden.

State attributes: `data-current`, `data-changed`, `data-active` and `data-highlight` are mirrored from classes by `theme.js` (the option cards and model options carry `cur`, the keyboard cursor `act`). `data-state` (a chip: ok / missing; a test result: run / ok / fail / cancel; the cache block: on / na; the prompt view: none) and `data-code` (the failure of a test: nokey, noaddr, unreachable, badkey, timeout, warming, nomodel, and for translation offline, notrmodel, dlfail) are written by the templates in `slice5b.js`, as slices 4 and 5a did (the integration moves them into the one mirror table). `th5b` checks each one is on exactly the elements in that state.

New role tokens (declared at the top of `slice5b.css`, read only through `var()`; the main session merges them into `theme-tokens.css`): `--p5b-bar` (the bar of a failed test, the missing connection, a reason line and the guard), `--p5b-wave-h` and `--p5b-wave-w` (the voice test waveform), `--p5b-tile` (the test image tile), `--p5b-list-max` (the tallest the model list gets), `--p5b-rbar-h` and `--p5b-swatch` (the ratio bar and its colour keys), `--p5b-opt-indent` (what hangs under a radio option), `--p5b-field-gap` (spacing of the blocks of a section). Everything else reads the existing ladder, `--nexus-*` and slice 4's `--param-dim-opacity`.

The pack registry (`checks/th/packlint-settings.mjs`) is left as it was; `checks/th5b/registry5b.mjs` extends slice 5a's registry with the 34 names (9 critical, 6 safe, 19 reach) and the **floor** (`minimums`, chat DD-182/DD-187, judged over the worst case by DD-195): `--p5b-bar` 2px (the smallest bar at which a warning still reads as an edge), in px only. A pack that sets it lower, under a root attribute, inside `@media` or through a `var()` fallback is rejected with "below the critical minimum". The earlier floors (`--param-dim-opacity`, `--param-warn-bar`, `--p5-warn-bar`) stay. The main session lifts the names and `MINIMUMS5B` into `packlint-settings.mjs` when slice 5b is integrated.
