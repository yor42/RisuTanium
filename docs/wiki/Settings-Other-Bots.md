# Settings: Other Bots

Part of [[Settings]]. Open **Settings → Other Bots**. The page has four tabs: **Long Term Memory**, **TTS**, **Emotion Images** and **Image Generation**. With **Use Legacy GUI** on, the tab bar is replaced by four individually collapsible accordion sections, one per tab, each starting collapsed.
<!-- src/lib/Setting/Pages/OtherBotSettings.svelte:25,254,945,970,981; src/lib/UI/Accordion.svelte -->

Two general notes that apply to every numeric field on this page:

- On a plain number box, the shown minimum/maximum is a hint only. The browser does not stop you from typing a value outside it, and it is sent to the provider as typed.
- On a slider, the minimum/maximum is enforced: dragging or using the keyboard cannot move the value past either end.
<!-- src/lib/UI/GUI/NumberInput.svelte:17-24; src/lib/UI/GUI/SliderInput.svelte:111-118,120-144 -->

**Hide API Keys** (in **Settings → Display & Audio → Others**) masks a key field's text. On this page, only four key fields respect it: the Imagen **GoogleAI API Key**, the OpenAI-Compatible image **API Key**, the WaveSpeedAI **API Key**, and the Embedding section's **Voyage API Key**. Every other key or token field on this page (NovelAI, Dall-E/TTS's OpenAI key, Stability, Fal.ai, ComfyUI, the TTS provider keys, the SupaMemory/embedding OpenAI key, and the custom-embedding key/password) is always shown in plain text, regardless of that setting.
<!-- src/ts/setting/displaySettingsData.svelte.ts:297; src/lib/Setting/Pages/OtherBotSettings.svelte:754,794,819,1321 -->

Most key fields on this page also accept a ${NAME} environment-variable reference instead of a key. See [[API Keys from Environment Variables]].

A few fields are one stored value shared by more than one place on this page (or elsewhere in the app). Editing the field in one place changes it everywhere it appears:

- The **NovelAI API Key** on the Image Generation tab and the **NovelAI API key** on the TTS tab are the same field.
- The **OpenAI API Key** used for Dall-E and the **OpenAI Key** used for TTS are the same field (also the app's general OpenAI text-completion key).
- `supaMemoryPrompt` and `supaMemoryKey` are shared between HypaMemory V2's SuperMemory settings and the plain SupaMemory settings, and `supaMemoryKey` is reused again as the OpenAI key under the Embedding section.
- The Imagen **GoogleAI API Key** (`google.accessToken`) is the same field as the Google/Gemini API key on **Settings → Chat Bot**.
<!-- NAIApiKey: OtherBotSettings.svelte:308-638 (Image Generation) and :944-967 (TTS); openAIKey: OtherBotSettings.svelte:642-652 (Dall-E) and :944-967 (TTS); supaMemoryKey/supaMemoryPrompt: OtherBotSettings.svelte:1038-1055, 1259-1280, 1282-1322; google.accessToken: OtherBotSettings.svelte:752-787, BotSettings.svelte:164-167 -->

---

## Long Term Memory

This tab picks and configures the app's memory system. What each system actually does, how they compare, and their priority when more than one is enabled in stored data are covered on [[Long Term Memory]], [[HypaMemory V3]], [[HypaMemory V2]], [[SupaMemory]] and [[Hanurai Memory]]. This section only describes the controls.

### Type

A single dropdown chooses which memory system is active:

| Option | Label |
|---|---|
| `none` | None |
| `supaMemory` | SupaMemory |
| `hypaV2` | HypaMemory V2 |
| `hanuraiMemory` | HanuraiMemory |
| `hypaV3` | HypaMemory V3 |

Picking one turns the other three off. Note: this dropdown lists the systems in a different order of priority than the order the app actually uses at runtime when more than one system's flags are set in stored data (for example by an older save or a manual edit) — see [[Long Term Memory]] for the runtime order.
<!-- src/lib/Setting/Pages/OtherBotSettings.svelte:982-1029 -->

### HanuraiMemory fields (shown when Type is HanuraiMemory)

| Label | Field | Default | Range | What it does |
|---|---|---|---|---|
| Chunk Size | `hanuraiTokens` | 1000 | min 100, no max | A token reservation used while trimming old messages; see [[Hanurai Memory]] for how retrieval fill actually works. |
| Text Spliting | `hanuraiSplit` (checkbox) | off | — | Whether HanuraiMemory splits text before embedding it. |
<!-- src/lib/Setting/Pages/OtherBotSettings.svelte:1031-1037 -->

### HypaMemory V2 fields (shown when Type is HypaMemory V2)

| Label | Field | Default | Options/Range | What it does |
|---|---|---|---|---|
| SuperMemory Model | `supaModelType` | `distilbart` | distilbart-cnn-6-6 (Free/Local), OpenAI 3.5 Turbo Instruct, Auxiliary Model | Which model summarizes chunks. |
| SuperMemory OpenAI Key | `supaMemoryKey` | empty | free text | Shown when SuperMemory Model is OpenAI 3.5 Turbo Instruct, or when a legacy `davinci`/`curie` value is already set in the save (not offered in the dropdown itself). Shared with the SupaMemory and Embedding sections' OpenAI key. |
| Summarization Prompt | `supaMemoryPrompt` | empty | free text, ChatML formatting allowed | Prompt used for summarization; blank uses the default prompt. Shared with the plain SupaMemory section. |
| Chunk Size | `hypaChunkSize` | 3000 | min 100 | V2's own chunking budget. |
| Allocated Tokens | `hypaAllocatedTokens` | 3000 | min 100 | V2's memory-block token budget. |
<!-- src/lib/Setting/Pages/OtherBotSettings.svelte:1038-1055 (OpenAI Key visibility: :1043-1046) -->

### HypaMemory V3 (shown when Type is HypaMemory V3)

Settings for V3 live in **presets** — named, reusable bundles, independent of any one character or chat. The preset row has:

| Control | Does |
|---|---|
| Preset dropdown | Switches which preset is being edited/used. |
| + (add) | Creates a new preset with the defaults below and selects it. |
| Pencil (rename) | Renames the current preset. Does nothing if you leave the name blank. |
| Trash (delete) | Deletes the current preset. Blocked if it is the only preset left. |
| Download (export) | Downloads the preset as a JSON file. |
| Upload (import) | Loads a preset from a JSON file exported this way and adds it as a new preset. |
<!-- src/lib/Setting/Pages/OtherBotSettings.svelte:1059-1174; src/ts/process/memory/hypav3.ts:1786-1825 -->

Preset fields:

| Label | Field | Default | Options/Range | What it does |
|---|---|---|---|---|
| SuperMemory Model | `summarizationModel` | Auxiliary Model | Auxiliary Model; plus, only if your browser reports GPU support, three local Qwen3 models | Which model summarizes chats. |
| Summarization Prompt | `summarizationPrompt` | empty | free text | Blank uses the built-in default. |
| Re-summarization Prompt | `reSummarizationPrompt` | empty | free text | Used when merging several selected summaries into one via bulk edit. Blank uses the built-in default. |
| Max Memory Tokens Ratio (Estimated) | — (display only, not saved) | — | — | An informational, disabled number showing an estimate; not a setting. |
| Memory Tokens Ratio | `memoryTokensRatio` | 0.2 | 0–1, step 0.01 | Fraction of the max context reserved for the long-term memory block. |
| Extra Summarization Ratio | `extraSummarizationRatio` | 0 | 0 to (1 − Memory Tokens Ratio) | Lowers the threshold at which summarization stops. |
| Max Chats Per Summary | `maxChatsPerSummary` | 6 | min 1 | Maximum messages grouped into one summary. |
| Query Chat Count | `queryChatCount` | 3 | min 1, max 20 | How many recent messages are used to build the retrieval query. |
| Chunk Separator Regex | `summaryChunkSeparator` | `\n\n` | free text (regex) | Pattern used to split text into chunks. |
| Recent Memory Ratio | `recentMemoryRatio` | 0.4 | 0–1, step 0.01 | Share of the memory budget filled with the most recent summaries. Changing this or Similar Memory Ratio automatically shrinks the other so their sum never exceeds 1. |
| Similar Memory Ratio | `similarMemoryRatio` | 0.4 | 0–1, step 0.01 | Share of the budget filled by similarity search. Clamped together with Recent Memory Ratio as above. |
| Random Memory Ratio | — (display only, not saved) | 1 − Recent − Similar | — | Share left over, filled randomly from summaries not already picked by the other two categories. |
| Preserve Orphaned Memory | `preserveOrphanedMemory` (checkbox) | off | — | If on, summaries that reference since-deleted chat messages are kept instead of removed. |
| Apply Regex Script When Rerolling | `processRegexScript` (checkbox) | off | — | Applies your character's regex scripts when a summary is rerolled. |
| Do Not Summarize User Message | `doNotSummarizeUserMessage` (checkbox) | off | — | Excludes user messages from the "max messages per summary" count. |
<!-- src/ts/process/memory/hypav3.ts:1786-1825; queryChatCount: hypav3.ts:50, bound OtherBotSettings.svelte:1210; summaryChunkSeparator: hypav3.ts:42, bound OtherBotSettings.svelte:1212; help text keys read from src/lang/en.ts -->

**Advanced Settings** (a nested, always-expandable sub-section):

| Label | Field | Default | Options/Range | What it does |
|---|---|---|---|---|
| Use Experimental Implementation | `useExperimentalImpl` (checkbox) | off | — | Switches to an experimental HypaMemory V3 implementation, enables the four rate-limit fields below, and changes the query method. |
| Always Toggle On | `alwaysToggleOn` (checkbox) | off | — | Automatically turns the character's HypaMemory toggle on when you select that character. |
| Summarization Requests Per Minute | `summarizationRequestsPerMinute` | 20 | min 1, no upper bound on this page | Rate limit for summarization calls. Shown only with Use Experimental Implementation on. |
| Summarization Max Concurrent | `summarizationMaxConcurrent` | 1 | min 1, max 10 | Concurrency limit for summarization calls. Shown only with Use Experimental Implementation on. |
| Embedding Requests Per Minute | `embeddingRequestsPerMinute` | 100 | min 1, no upper bound on this page | Rate limit for embedding calls. Shown only with Use Experimental Implementation on. |
| Embedding Max Concurrent | `embeddingMaxConcurrent` | 1 | min 1, max 10 | Concurrency limit for embedding calls. Shown only with Use Experimental Implementation on. |
| Enable Similarity Correction | `enableSimilarityCorrection` (checkbox) | off | — | Adds a summary of recent chats as an extra query. Does not work together with the experimental implementation. Shown only with Use Experimental Implementation off. |
<!-- src/lib/Setting/Pages/OtherBotSettings.svelte:1231-1255 -->

### SupaMemory fields (shown when Type is SupaMemory)

| Label | Field | Default | Options/Range | What it does |
|---|---|---|---|---|
| SuperMemory Model | `supaModelType` | `distilbart` | distilbart, OpenAI 3.5 Turbo Instruct, Auxiliary Model | Which model produces the rolling summary. |
| Max SupaMemory Chunk Size | `maxSupaChunkSize` | 1200 | min 100 | SupaMemory's own chunk-size budget (a separate field from HypaMemory V2's Chunk Size/Allocated Tokens). |
| SuperMemory OpenAI Key | `supaMemoryKey` | empty | free text | Shown for the OpenAI-backed model choices. Same field as V2's key above. |
| SuperMemory Prompt | `supaMemoryPrompt` | empty | free text (single-line here, unlike the text area shown in the V2 branch for the same field) | Same stored value as V2's Summarization Prompt. |
| Enable HypaMemory | `hypaMemory` (checkbox) | off | — | Adds HypaMemory v1's vector-search retrieval on top of the rolling summary; see [[SupaMemory]]. |
<!-- src/lib/Setting/Pages/OtherBotSettings.svelte:1259-1280 -->

### Embedding

Shown at the bottom of this tab at all times, even with Type set to None, because the embedding model is used by more than just long-term memory (also Additional Text matching, Dynamic Assets, Trigger Scripts, PDF/TXT/XML file attachments, and Playground).

| Label | Field | Default | Options | What it does |
|---|---|---|---|---|
| Embedding | `hypaModel` | `MiniLM` | Local CPU models (MiniLM, Nomic, BGE Small English, BGE Medium 3, Multilingual MiniLM, BGE Medium 3 Korean), the same models' GPU variants (shown only if your browser reports GPU support), OpenAI (text-embedding-3-small/large, Ada), Voyage Context 3, or Custom | Selects the shared embedding backend. |
| OpenAI API Key | `supaMemoryKey` | empty | free text | Shown for the three OpenAI embedding options. Reuses the same stored field as the SupaMemory OpenAI Key above — setting one changes the other. |
| URL / Key-Password / Request Model | `hypaCustomSettings.url/key/model` | empty | free text | Shown for Custom: an OpenAI-compatible embedding endpoint. |
| Voyage API Key | `voyageApiKey` | empty | free text | Shown for Voyage Context 3. Masked by **Hide API Keys**. |
<!-- src/lib/Setting/Pages/OtherBotSettings.svelte:1282-1322 -->

---

## TTS

This tab holds account-level TTS credentials and server addresses shared by every character. Picking a provider and voice for a character is done on the character's own TTS page — see [[TTS]] for that, and for what each provider needs.

| Label | Field | Default | What it does |
|---|---|---|---|
| Auto Speech | `ttsAutoSpeech` (checkbox) | off | When on, a newly generated reply is spoken automatically, without pressing the speaker button. |
| ElevenLabs API key | `elevenLabKey` | empty | Account key for ElevenLabs TTS. |
| VOICEVOX URL | `voicevoxUrl` | empty | Base URL of a VOICEVOX Engine you run yourself. |
| OpenAI Key | `openAIKey` | empty | Used for OpenAI TTS voices. Same stored key as Dall-E's OpenAI API Key on the Image Generation tab. |
| NovelAI API key | `NAIApiKey` | empty | Used for NovelAI TTS voices. Same stored key as the NovelAI API Key on the Image Generation tab. |
| Huggingface Key | `huggingfaceKey` | empty | Bearer key for Huggingface's Inference API. |
| fish-speech API Key | `fishSpeechKey` | empty | Key for fish-speech (fish.audio) TTS. |

None of these seven fields has a help tooltip.
<!-- src/lib/Setting/Pages/OtherBotSettings.svelte:944-967; src/ts/process/index.svelte.ts:1850,1918 -->

---

## Emotion Images

| Label | Field | Default | Options | What it does |
|---|---|---|---|---|
| Emotion Method | `emotionProcesser` | Ax. Model | **Ax. Model** — uses the configured Auxiliary Model (an LLM call) to pick an emotion; **MiniLM-L6-v2** — uses the embedding model configured under Long Term Memory's Embedding dropdown to match against the character's emotion-image labels by similarity instead | Chooses how the app decides which emotion image to show. |

"Ax. Model" is short for Auxiliary Model — see its own tooltip elsewhere in the app: "Auxiliary Model is a model that used in analyzing emotion images and auto suggestions and etc. gpt3.5 is recommended." There is no help tooltip on the Emotion Method control itself. Setting up the emotion images themselves (uploading per-emotion art for a character) is covered on [[Additional Character Screen]].
<!-- src/lib/Setting/Pages/OtherBotSettings.svelte:969-977; src/ts/process/index.svelte.ts:2067 -->

---

## Image Generation

### Provider

| Option | Label |
|---|---|
| (blank) | None — image generation is off |
| `webui` | Stable Diffusion WebUI |
| `novelai` | Novel AI |
| `dalle` | Dall-E |
| `stability` | Stability API |
| `fal` | Fal.ai |
| `comfyui` | ComfyUI |
| `Imagen` | Imagen |
| `openai-compat` | OpenAI Compatible |
| `wavespeed` | WaveSpeedAI |

There is also a "ComfyUI (Legacy)" entry, kept only for a save that already has it set from before the current ComfyUI panel existed; it is not offered as a choice on a fresh dropdown.
<!-- src/lib/Setting/Pages/OtherBotSettings.svelte:253-271; src/ts/process/stableDiff.ts:15 -->

### Stable Diffusion WebUI

| Label | Field | Default | Range | Notes |
|---|---|---|---|---|
| WebUI Request URL | `webUiUrl` | `http://127.0.0.1:7860/` | free text | Base URL for the WebUI `/sdapi/v1/txt2img` API. |
| Steps | `sdSteps` | 30 | 0–100 | |
| CFG Scale | `sdCFG` | 7 | 0–20 | |
| Width / Height | `sdConfig.width/height` | 512 / 512 | 0–2048 | Also used by the Fal.ai panel below. |
| Sampler | `sdConfig.sampler_name` | `Euler a` | free text | |
| Enable Hires | `sdConfig.enable_hr` (checkbox) | off | — | Reveals the next three fields. |
| (hires) denoising_strength | `sdConfig.denoising_strength` | 0.7 | 0–10 | |
| (hires) hr_scale | `sdConfig.hr_scale` | 1.25 | 0–10 | |
| (hires) Upscaler | `sdConfig.hr_upscaler` | `Latent` | free text | |

The page also shows static text under this provider: a reminder that WebUI must be started with `--api`, an AGPL license notice, and (web build only) a note to use a tunnel such as ngrok.
<!-- src/lib/Setting/Pages/OtherBotSettings.svelte:274-306; src/ts/process/stableDiff.ts:67-121 -->

### NovelAI

| Label | Field | Default | Options/Range | Notes |
|---|---|---|---|---|
| NovelAI Request URL | `NAIImgUrl` | `https://image.novelai.net/ai/generate-image` | free text | |
| API Key | `NAIApiKey` | empty | free text | Same stored key as the TTS tab's NovelAI API key. |
| Model | `NAIImgModel` | `nai-diffusion-4-5-full` | nai-diffusion-5-full, nai-diffusion-5-curated, nai-diffusion-4-5-full, nai-diffusion-4-5-curated, nai-diffusion-4-full, nai-diffusion-4-curated-preview, nai-diffusion-3, nai-diffusion-furry-3, nai-diffusion-2 | Many of the fields below only appear for certain models. |
| Width / Height | `NAIImgConfig.width/height` | 1024 / 1024 | 0–2048 | |
| Sampler | `NAIImgConfig.sampler` | `k_euler_ancestral` | 6 options for the v4/v4.5-full models, 7 for the others | |
| Noise Schedule | `NAIImgConfig.noise_schedule` | `karras` | native, karras, exponential, polyexponential | |
| Steps | `NAIImgConfig.steps` | 28 | 0–2048 | |
| CFG scale | `NAIImgConfig.scale` | 5 | 0–2048 | |
| CFG rescale | `NAIImgConfig.cfg_rescale` | 0 | 0–1 | |
| Image Reference | `NAIImgConfig.reference_mode` | None | None, Vibe Transfer (all models), Character Reference (only nai-diffusion-4-5-full/curated) | Shows the matching upload controls below. |
| Vibe upload | `.naiv4vibe` file picker | — | — | Loads a Vibe Transfer file and fills in the two fields below. |
| Vibe Model | `NAIImgConfig.vibe_model_selection` | (set on upload) | built from the uploaded file's contents | |
| Information Extracted | `NAIImgConfig.InfoExtracted` | 1 | built from the uploaded file's contents | Which pre-computed encoding strength to use. |
| Reference Strength Multiple | `NAIImgConfig.reference_strength_multiple[0]` | set to 0.7 on first upload | 0–1, step 0.1 | |
| Character reference image | image file (jpg/jpeg/png/webp) | blank | — | Blank falls back to the character's own default image. Only shown for nai-diffusion-4-5-full/curated. |
| Style Aware | checkbox | off | — | |
| Use SMEA | checkbox | on | — | Shown only for nai-diffusion-3/furry-3/2 with a non-`ddim_v3` sampler. |
| Use DYN | checkbox | off | — | Shown only for nai-diffusion-3 with a non-`ddim_v3` sampler. |
| Variety+ | checkbox | off | — | Shown for v4/v4.5-full/curated and v3/furry-3. |
| Decrisp | checkbox | off | — | Shown for v3/furry-3/v2. |
| Use legacy uc | checkbox | off | — | Shown only for nai-diffusion-4-full/4-curated-preview. |
| Enable I2I | `NAII2I` (checkbox) | off | — | Turns on image-to-image; reveals the next three controls. |
| (I2I) source image | image file | blank | — | Blank falls back to the character's default image. |
| (I2I) Strength | `NAIImgConfig.strength` | 0.6 | 0–0.99, step 0.01 | |
| (I2I) Noise | `NAIImgConfig.noise` | 0.0 | 0–0.99, step 0.01 | |
<!-- src/lib/Setting/Pages/OtherBotSettings.svelte:308-638; src/ts/process/stableDiff.ts:123-357 -->

### Dall-E

| Label | Field | Default | Options | Notes |
|---|---|---|---|---|
| OpenAI API Key | `openAIKey` | empty | free text | Same stored key as TTS's OpenAI Key. |
| Dall-E Quality | `dallEQuality` | `standard` | standard, hd | |

This panel offers no request-URL, size, or model controls; those are not exposed as settings for this provider.
<!-- src/lib/Setting/Pages/OtherBotSettings.svelte:642-652; src/ts/process/stableDiff.ts:390-431 -->

### Stability API

| Label | Field | Default | Options | Notes |
|---|---|---|---|---|
| Stability API Key | `stabilityKey` | empty until set | free text | |
| Stability Model | `stabilityModel` | `sd3-large` | SD Ultra (`ultra`), SD Core (`core`), SD3 Large (`sd3-large`), SD3 Medium (`sd3-medium`) | |
| SD Core Style | `stabllityStyle` | Unspecified | Unspecified plus 17 style presets (3d-model, analog-film, anime, cinematic, comic-book, digital-art, enhance, fantasy-art, isometric, line-art, low-poly, modeling-compound, neon-punk, origami, photographic, pixel-art, tile-texture) | Shown only when Model is SD Core. |
<!-- src/lib/Setting/Pages/OtherBotSettings.svelte:654-689 (Model options :660-663); src/ts/process/stableDiff.ts:433-483 -->

### ComfyUI (and legacy ComfyUI)

| Label | Field | Default | Notes |
|---|---|---|---|
| ComfyUI Request URL | `comfyUiUrl` | `http://localhost:8188` | |
| Workflow | `comfyConfig.workflow` | empty | The API workflow JSON for ComfyUI, current provider only. Must include the `risu_prompt` placeholder for the prompt text to be inserted. |
| Timeout (sec) | `comfyConfig.timeout` | 30 | 1–120. |
| Positive/Negative Text Node ID and Input Field Name (4 text fields) | `comfyConfig.posNodeID`, `posInputName`, `negNodeID`, `negInputName` | empty, `text`, empty, `text` | Legacy provider only; the current ComfyUI panel does not expose these. |

The legacy panel also shows static notes: that the first image generated by the prompt is used, and (web build only) to run ComfyUI with `--enable-cors-header`.
<!-- src/lib/Setting/Pages/OtherBotSettings.svelte:691-722; src/ts/process/stableDiff.ts:485-583 -->

### Fal.ai

| Label | Field | Default | Options | Notes |
|---|---|---|---|---|
| Fal.ai API Key | `falToken` | empty until set | free text | |
| Width / Height | `sdConfig.width/height` | 512 / 512 | 0–2048 | Same stored fields as the WebUI panel. |
| Model | `falModel` | `fal-ai/flux/dev` | Flux[Dev], Flux[Dev] with Lora, Flux[Pro], Flux[Schnell] | |
| Lora Model URL | `falLora` | empty until set | free text | Shown only for the Lora model. Accepts a direct download link or a CivitAI AIR identifier; a Google Drive share link must first be converted to a direct link (for example with gdocs2direct). |
| Lora Weight | `falLoraScale` | 1 | 0–2, step 0.01 | |
<!-- src/lib/Setting/Pages/OtherBotSettings.svelte:724-750; src/ts/process/stableDiff.ts:618-677 -->

### Imagen

| Label | Field | Default | Options | Notes |
|---|---|---|---|---|
| GoogleAI API Key | `google.accessToken` | — | free text | Masked by **Hide API Keys**. |
| Model | `ImagenModel` | `imagen-4.0-generate-001` | Imagen 4, Imagen 4 Ultra, Imagen 4 Fast, Imagen 3.0 | |
| Image size | `ImagenImageSize` | `1K` | 1K, 2K | Shown only for the two non-Fast 4.0 models; Imagen 4 Fast has no size control. |
| Aspect ratio | `ImagenAspectRatio` | `1:1` | 1:1, 3:4, 4:3, 9:16, 16:9 | |
| Person generation | `ImagenPersonGeneration` | `allow_all` | allow_all, allow_adult, dont_allow | |
<!-- src/lib/Setting/Pages/OtherBotSettings.svelte:752-787; src/ts/process/stableDiff.ts:678-726 -->

### OpenAI Compatible

| Label | Field | Default | Options | Notes |
|---|---|---|---|---|
| API URL | `openaiCompatImage.url` | empty | free text | |
| API Key | `openaiCompatImage.key` | empty | free text | Masked by **Hide API Keys**. |
| Model | `openaiCompatImage.model` | empty | free text | |
| Image Size | `openaiCompatImage.size` | `1024x1024` | 1024x1024, 1536x1024, 1024x1536, 512x512, 256x256 | |
| Quality | `openaiCompatImage.quality` | `auto` | auto, low, medium, high | |
<!-- src/lib/Setting/Pages/OtherBotSettings.svelte:789-815; src/ts/process/stableDiff.ts:727-784 -->

### WaveSpeedAI

| Label | Field | Default | Notes |
|---|---|---|---|
| API Key | `wavespeedImage.key` | empty | Masked by **Hide API Keys**. Used both for the model list and for image generation. |
| Refresh Models (button) | — (not saved) | — | Fetches the current WaveSpeedAI model catalog, keeps only text-to-image/image-to-image models, and fills the Model dropdown. |
| Search models | — (not saved) | — | Filters the Model dropdown by matching your search terms against each model's name and ID. |
| Model | `wavespeedImage.model` | empty | Options come from the fetched catalog. If none has been fetched yet, only the already-saved model ID is shown. Switching to a model without image-input support clears the reference-image fields below; switching to one without LoRA support clears the LoRA fields. |
| LoRAs (up to 3) | `wavespeedImage.loras` | none | Each slot has a URL field and a scale slider (0–4, step 0.1). Only shown if the selected model supports LoRA. Blank URLs are not saved. |
| Image Reference | `wavespeedImage.reference_mode` | None | None, Upload Image, Use Character Image. Only shown if the selected model supports image input. |
| Upload Image | `wavespeedImage.reference_image` (jpg/jpeg/png/webp) | empty | Reference image for image-to-image, shown when Image Reference is Upload Image. |
<!-- src/lib/Setting/Pages/OtherBotSettings.svelte:817-940 -->
