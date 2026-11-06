# Settings: Other Bots

This page belongs to [[Settings]]. To open it, go to **Settings → Other Bots**. The page has four tabs: **Long Term Memory**, **TTS**, **Emotion Images**, and **Image Generation**. When **Use Legacy GUI** is on, four accordion sections replace the tab bar. There is one section for each tab. You can collapse each section on its own, and each starts collapsed.
<!-- src/lib/Setting/Pages/OtherBotSettings.svelte:25,254,945,970,981; src/lib/UI/Accordion.svelte -->

Two general notes apply to every numeric field on this page:

- On a plain number box, the minimum and maximum that the page shows are only a hint. The browser does not stop you from typing a value outside them. The app sends the value to the provider as you typed it.
- On a slider, the app enforces the minimum and maximum. You cannot drag the value past either end, and you cannot move it past an end with the keyboard.
<!-- src/lib/UI/GUI/NumberInput.svelte:17-24; src/lib/UI/GUI/SliderInput.svelte:111-118,120-144 -->

**Hide API Keys** (in **Settings → Display & Audio → Others**) masks the text of a key field. On this page, only four key fields respect it:
- The **GoogleAI API Key** of Imagen.
- The **API Key** of the OpenAI-Compatible image provider.
- The **API Key** of WaveSpeedAI.
- The **Voyage API Key** in the Embedding section.

Every other key or token field on this page is always shown in plain text, whatever that setting says. These are the fields for NovelAI, the OpenAI key of Dall-E and TTS, Stability, Fal.ai, ComfyUI, the TTS provider keys, the OpenAI key of SupaMemory and embeddings, and the key or password of the custom embedding.
<!-- src/ts/setting/displaySettingsData.svelte.ts:297; src/lib/Setting/Pages/OtherBotSettings.svelte:754,794,819,1321 -->

Most key fields on this page also accept a ${NAME} reference to an environment variable instead of a key. See [[API Keys from Environment Variables]].

A few fields are one stored value that more than one place on this page (or elsewhere in the app) shares. If you edit the field in one place, it changes everywhere it appears:

- The **NovelAI API Key** on the Image Generation tab and the **NovelAI API key** on the TTS tab are the same field.
- The **OpenAI API Key** that Dall-E uses and the **OpenAI Key** that TTS uses are the same field. It is also the general OpenAI text-completion key of the app.
- `supaMemoryPrompt` and `supaMemoryKey` are shared between the SupaMemory settings of HypaMemory V2 and the plain SupaMemory settings. `supaMemoryKey` is used again as the OpenAI key under the Embedding section.
- The **GoogleAI API Key** of Imagen (`google.accessToken`) is the same field as the Google/Gemini API key on **Settings → Chat Bot**.
<!-- NAIApiKey: OtherBotSettings.svelte:322 (Image Generation) and :988-989 (TTS); openAIKey: OtherBotSettings.svelte:668 (Dall-E) and :985-986 (TTS); supaMemoryKey/supaMemoryPrompt: OtherBotSettings.svelte:1069-1086, 1270-1290, 1293-1335; google.accessToken: OtherBotSettings.svelte:778, BotSettings.svelte:180 -->

---

## Long Term Memory

This tab picks and configures the memory system of the app. These pages cover what each system does, how they compare, and their priority when stored data enables more than one: [[Long Term Memory]], [[HypaMemory V3]], [[HypaMemory V2]], [[SupaMemory]], and [[Hanurai Memory]]. This section describes only the controls.

### Type

A single dropdown chooses which memory system is active:

| Option | Label |
|---|---|
| `none` | None |
| `supaMemory` | SupaMemory |
| `hypaV2` | HypaMemory V2 |
| `hanuraiMemory` | HanuraiMemory |
| `hypaV3` | HypaMemory V3 |

When you pick one, the app turns the other three off. Note: The option list has a different order than the priority that the app uses at runtime. This matters when stored data sets the flags of more than one system, for example an older save or a manual edit. See [[Long Term Memory]] for the runtime order. The value that the dropdown displays follows the runtime order: HanuraiMemory, then HypaMemory V2, then HypaMemory V3, then SupaMemory, then None. So for such data, it shows the system that actually runs. **Fork difference:** The displayed value follows the runtime order. The option list is unchanged.
<!-- src/lib/Setting/Pages/OtherBotSettings.svelte:1011-1060 (displayed value :1015-1019) -->

### HanuraiMemory fields (shown when Type is HanuraiMemory)

| Label | Field | Default | Range | What it does |
|---|---|---|---|---|
| Chunk Size | `hanuraiTokens` | 1000 | min 100, no max | A token reservation that the app uses while it trims old messages. It is also the limit for the retrieved block (**fork difference**: upstream treats it as a reservation only). See [[Hanurai Memory]] for how the retrieval fill works. |
| Text Spliting | `hanuraiSplit` (checkbox) | off | none | Whether HanuraiMemory splits text before it embeds it. |
<!-- src/lib/Setting/Pages/OtherBotSettings.svelte:1062-1068; src/ts/process/memory/hanuraiMemory.ts:92-114 -->

### HypaMemory V2 fields (shown when Type is HypaMemory V2)

| Label | Field | Default | Options/Range | What it does |
|---|---|---|---|---|
| SupaMemory Model | `supaModelType` | `distilbart` | distilbart-cnn-6-6 (Free/Local), OpenAI 3.5 Turbo Instruct, Auxiliary Model | Which model summarizes chunks. |
| SupaMemory OpenAI Key | `supaMemoryKey` | empty | free text | The page shows it when SupaMemory Model is OpenAI 3.5 Turbo Instruct. Every time the settings load, the app changes a saved `davinci` or `curie` value (not offered in the dropdown) to OpenAI 3.5 Turbo Instruct (**fork difference**: The request code of upstream still sends the old model ids; `src/ts/storage/database.svelte.ts:257-261`). The OpenAI key of the SupaMemory section and of the Embedding section shares this field. |
| Summarization Prompt | `supaMemoryPrompt` | empty | free text, ChatML formatting allowed | The prompt that the app uses for summarization. If it is blank, the app uses the default prompt. The plain SupaMemory section shares this field. |
| Chunk Size | `hypaChunkSize` | 3000 | min 100 | The own budget of V2 for chunking. |
| Allocated Tokens | `hypaAllocatedTokens` | 3000 | min 100 | The token budget of V2 for the memory block. |
<!-- src/lib/Setting/Pages/OtherBotSettings.svelte:1069-1086 (OpenAI Key visibility: :1077-1080); src/ts/storage/database.svelte.ts:257-261 -->

### HypaMemory V3 (shown when Type is HypaMemory V3)

The settings for V3 live in **presets**. A preset is a named, reusable bundle. It does not depend on any one character or chat. The preset row has these controls:

| Control | What it does |
|---|---|
| Preset dropdown | Switches the preset that you edit and use. |
| + (add) | Creates a new preset with the defaults below and selects it. |
| Pencil (rename) | Renames the current preset. It does nothing if you leave the name blank. |
| Trash (delete) | Deletes the current preset. The app blocks this if the preset is the only one left. |
| Download (export) | Downloads the preset as a JSON file. |
| Upload (import) | Loads a preset from a JSON file that you exported this way, and adds it as a new preset. |
<!-- src/lib/Setting/Pages/OtherBotSettings.svelte:1087-1186; src/ts/process/memory/hypav3.ts:1833-1877 -->

Preset fields:

| Label | Field | Default | Options/Range | What it does |
|---|---|---|---|---|
| SupaMemory Model | `summarizationModel` | Auxiliary Model | Auxiliary Model. Three local Qwen3 models are added, but only if your browser reports GPU support. | Which model summarizes chats. |
| Summarization Prompt | `summarizationPrompt` | empty | free text | If it is blank, the app uses the built-in default. |
| Re-summarization Prompt | `reSummarizationPrompt` | empty | free text | The app uses it when it merges several selected summaries into one through bulk edit. If it is blank, the app uses the built-in default. |
| Max Memory Tokens Ratio (Estimated) | none (display only, not saved) | none | none | A disabled number with information. It shows an estimate. It is not a setting. |
| Memory Tokens Ratio | `memoryTokensRatio` | 0.2 | 0–1, step 0.01 | The fraction of the max context that the app reserves for the long-term memory block. |
| Extra Summarization Ratio | `extraSummarizationRatio` | 0 | 0 to (1 − Memory Tokens Ratio) | Lowers the threshold at which summarization stops. |
| Max Messages Per Summary | `maxChatsPerSummary` | 6 | min 1 | The maximum number of messages that the app groups into one summary. Messages that summarization leaves out do not count toward it (**fork difference** in the standard implementation; see [[HypaMemory V3]]). |
| Query Chat Count | `queryChatCount` | 3 | min 1, max 20 | How many recent messages the app uses to build the retrieval query. |
| Chunk Separator Regex | `summaryChunkSeparator` | `\n\n` | free text (regex) | The pattern that splits text into chunks. |
| Recent Memory Ratio | `recentMemoryRatio` | 0.4 | 0–1, step 0.01 | The share of the memory budget that the app fills with the most recent summaries. If you change this or Similar Memory Ratio, the app shrinks the other one automatically. So their sum never exceeds 1. |
| Similar Memory Ratio | `similarMemoryRatio` | 0.4 | 0–1, step 0.01 | The share of the budget that the similarity search fills. The app limits it together with Recent Memory Ratio, as above. |
| Random Memory Ratio | none (display only, not saved) | 1 − Recent − Similar | none | The share that is left over. The app fills it at random from summaries that the other two categories did not pick. |
| Preserve Orphaned Memory | `preserveOrphanedMemory` (checkbox) | off | none | If it is on, the app keeps summaries that refer to chat messages that someone deleted since then. It does not remove them. |
| Apply Regex Script When Rerolling | `processRegexScript` (checkbox) | off | none | Applies the regex scripts of your character when you reroll a summary. |
| Do Not Summarize User Message | `doNotSummarizeUserMessage` (checkbox) | off | none | Excludes user messages from the count of "max messages per summary". |
<!-- src/ts/process/memory/hypav3.ts:1833-1877; queryChatCount: hypav3.ts:56, bound OtherBotSettings.svelte:1221; summaryChunkSeparator: hypav3.ts:48, bound OtherBotSettings.svelte:1223; help text keys read from src/lang/en.ts -->

**Advanced Settings** (a nested sub-section that you can always expand):

| Label | Field | Default | Options/Range | What it does |
|---|---|---|---|---|
| Use Experimental Implementation | `useExperimentalImpl` (checkbox) | off | none | Switches to an experimental implementation of HypaMemory V3. Enables the four rate-limit fields below. Changes the query method. |
| Always Toggle On | `alwaysToggleOn` (checkbox) | off | none | Turns on the HypaMemory toggle of the character automatically when you select that character. |
| Summarization Requests Per Minute | `summarizationRequestsPerMinute` | 20 | min 1, no upper bound on this page | The rate limit for summarization calls. The page shows it only with Use Experimental Implementation on. |
| Summarization Max Concurrent | `summarizationMaxConcurrent` | 1 | min 1, max 10 | The limit for concurrency of summarization calls. The page shows it only with Use Experimental Implementation on. |
| Embedding Requests Per Minute | `embeddingRequestsPerMinute` | 100 | min 1, no upper bound on this page | The rate limit for embedding calls. The page shows it only with Use Experimental Implementation on. |
| Embedding Max Concurrent | `embeddingMaxConcurrent` | 1 | min 1, max 10 | The limit for concurrency of embedding calls. The page shows it only with Use Experimental Implementation on. |
| Enable Similarity Correction | `enableSimilarityCorrection` (checkbox) | off | none | Adds a summary of recent chats as an extra query. It does not work together with the experimental implementation. The page shows it only with Use Experimental Implementation off. |
<!-- src/lib/Setting/Pages/OtherBotSettings.svelte:1242-1266 -->

### SupaMemory fields (shown when Type is SupaMemory)

| Label | Field | Default | Options/Range | What it does |
|---|---|---|---|---|
| SupaMemory Model | `supaModelType` | `distilbart` | distilbart, OpenAI 3.5 Turbo Instruct, Auxiliary Model | Which model produces the rolling summary. |
| Max SupaMemory Chunk Size | `maxSupaChunkSize` | 1200 | min 100 | The own chunk-size budget of SupaMemory. This is a separate field from Chunk Size and Allocated Tokens of HypaMemory V2. |
| SupaMemory OpenAI Key | `supaMemoryKey` | empty | free text | The page shows it for the model choices that OpenAI backs. It is the same field as the key of V2 above. |
| SupaMemory Prompt | `supaMemoryPrompt` | empty | free text (a single line here. The V2 branch shows a text area for the same field.) | The same stored value as the Summarization Prompt of V2. |
| Enable HypaMemory | `hypaMemory` (checkbox) | off | none | Adds the vector-search retrieval of HypaMemory v1 on top of the rolling summary. See [[SupaMemory]]. |
<!-- src/lib/Setting/Pages/OtherBotSettings.svelte:1270-1290 -->

### Embedding

The page always shows this section at the bottom of this tab, even with Type set to None. The reason is that more than long-term memory uses the embedding model. Other users are the matching of Additional Text, Dynamic Assets, Trigger Scripts, the attachments of PDF, TXT, and XML files, and the Playground.

| Label | Field | Default | Options | What it does |
|---|---|---|---|---|
| Embedding | `hypaModel` | `MiniLM` | Local CPU models (MiniLM, Nomic, BGE Small English, BGE Medium 3, Multilingual MiniLM, BGE Medium 3 Korean). The GPU variants of the same models (shown only if your browser reports GPU support). OpenAI (text-embedding-3-small/large, Ada). Voyage Context 3. Or Custom. | Selects the shared embedding backend. |
| OpenAI API Key | `supaMemoryKey` | empty | free text | The page shows it for the three OpenAI embedding options. It uses the same stored field as the SupaMemory OpenAI Key above. If you set one, you change the other. |
| URL / Key-Password / Request Model | `hypaCustomSettings.url/key/model` | empty | free text | The page shows these for Custom: an embedding endpoint that is compatible with OpenAI. |
| Voyage API Key | `voyageApiKey` | empty | free text | The page shows it for Voyage Context 3. **Hide API Keys** masks it. |
<!-- src/lib/Setting/Pages/OtherBotSettings.svelte:1293-1335 -->

---

## TTS

This tab holds the credentials at the level of the account and the server addresses that every character shares. You pick a provider and a voice for a character on the own TTS page of that character. See [[TTS]] for that, and for what each provider needs.

| Label | Field | Default | What it does |
|---|---|---|---|
| Auto Speech | `ttsAutoSpeech` (checkbox) | off | When it is on, the app speaks a newly generated reply automatically. You do not press the speaker button. |
| ElevenLabs API key | `elevenLabKey` | empty | The account key for ElevenLabs TTS. |
| VOICEVOX URL | `voicevoxUrl` | empty | The base URL of a VOICEVOX Engine that you run yourself. |
| OpenAI Key | `openAIKey` | empty | The app uses it for OpenAI TTS voices. It is the same stored key as the OpenAI API Key of Dall-E on the Image Generation tab. |
| NovelAI API key | `NAIApiKey` | empty | The app uses it for NovelAI TTS voices. It is the same stored key as the NovelAI API Key on the Image Generation tab. |
| Huggingface Key | `huggingfaceKey` | empty | The bearer key for the Inference API of Huggingface. |
| fish-speech API Key | `fishSpeechKey` | empty | The key for fish-speech (fish.audio) TTS. |

None of these seven fields has a help tooltip.
<!-- src/lib/Setting/Pages/OtherBotSettings.svelte:944-967; src/ts/process/index.svelte.ts:1850,1918 -->

---

## Emotion Images

| Label | Field | Default | Options | What it does |
|---|---|---|---|---|
| Emotion Method | `emotionProcesser` | Ax. Model | **Ax. Model**: Uses the Auxiliary Model that you configured (an LLM call) to pick an emotion. **MiniLM-L6-v2**: Uses the embedding model that you configured in the Embedding dropdown of Long Term Memory. It matches by similarity against the labels of the emotion images of the character. | Chooses how the app decides which emotion image to show. |

"Ax. Model" is short for Auxiliary Model. See its own tooltip elsewhere in the app: "Auxiliary Model is a model that used in analyzing emotion images and auto suggestions and etc. gpt3.5 is recommended." The Emotion Method control itself has no help tooltip. To set up the emotion images themselves (to upload art for each emotion of a character), see [[Additional Character Screen]].
<!-- src/lib/Setting/Pages/OtherBotSettings.svelte:969-977; src/ts/process/index.svelte.ts:2067 -->

---

## Image Generation

### Provider

| Option | Label |
|---|---|
| (blank) | None. Image generation is off. |
| `webui` | Stable Diffusion WebUI |
| `novelai` | Novel AI |
| `dalle` | Dall-E |
| `stability` | Stability API |
| `fal` | Fal.ai |
| `comfyui` | ComfyUI |
| `Imagen` | Imagen |
| `openai-compat` | OpenAI Compatible |
| `wavespeed` | WaveSpeedAI |

There is also a "ComfyUI (Legacy)" entry. The app keeps it only for a save that already has it set from before the current ComfyUI panel existed. A fresh dropdown does not offer it as a choice.
<!-- src/lib/Setting/Pages/OtherBotSettings.svelte:253-271; src/ts/process/stableDiff.ts:15 -->

### Stable Diffusion WebUI

| Label | Field | Default | Range | Notes |
|---|---|---|---|---|
| WebUI Request URL | `webUiUrl` | `http://127.0.0.1:7860/` | free text | The base URL for the WebUI `/sdapi/v1/txt2img` API. |
| Steps | `sdSteps` | 30 | 0–100 | |
| CFG Scale | `sdCFG` | 7 | 0–20 | |
| Width / Height | `sdConfig.width/height` | 512 / 512 | 0–2048 | The Fal.ai panel below also uses it. |
| Sampler | `sdConfig.sampler_name` | `Euler a` | free text | |
| Enable Hires | `sdConfig.enable_hr` (checkbox) | off | none | Reveals the next three fields. |
| (hires) denoising_strength | `sdConfig.denoising_strength` | 0.7 | 0–10 | |
| (hires) hr_scale | `sdConfig.hr_scale` | 1.25 | 0–10 | |
| (hires) Upscaler | `sdConfig.hr_upscaler` | `Latent` | free text | |

The page also shows static text under this provider: a reminder that you must start WebUI with `--api`, an AGPL license notice, and (web build only) a note to use a tunnel such as ngrok.
<!-- src/lib/Setting/Pages/OtherBotSettings.svelte:274-306; src/ts/process/stableDiff.ts:67-121 -->

### NovelAI

| Label | Field | Default | Options/Range | Notes |
|---|---|---|---|---|
| NovelAI Request URL | `NAIImgUrl` | `https://image.novelai.net/ai/generate-image` | free text | |
| API Key | `NAIApiKey` | empty | free text | The same stored key as the NovelAI API key of the TTS tab. |
| Model | `NAIImgModel` | `nai-diffusion-4-5-full` | nai-diffusion-5-full, nai-diffusion-5-curated, nai-diffusion-4-5-full, nai-diffusion-4-5-curated, nai-diffusion-4-full, nai-diffusion-4-curated-preview, nai-diffusion-3, nai-diffusion-furry-3, nai-diffusion-2 | Many of the fields below appear only for certain models. |
| Width / Height | `NAIImgConfig.width/height` | 1024 / 1024 | 0–2048 | |
| Sampler | `NAIImgConfig.sampler` | `k_euler_ancestral` | 6 options for the v4/v4.5-full models, 7 for the others | |
| Noise Schedule | `NAIImgConfig.noise_schedule` | `karras` | native, karras, exponential, polyexponential | |
| Steps | `NAIImgConfig.steps` | 28 | 0–2048 | |
| CFG scale | `NAIImgConfig.scale` | 5 | 0–2048 | |
| CFG rescale | `NAIImgConfig.cfg_rescale` | 0 | 0–1 | |
| Image Reference | `NAIImgConfig.reference_mode` | None | None, Vibe Transfer (all models), Character Reference (only nai-diffusion-4-5-full/curated) | Shows the matching upload controls below. |
| Vibe upload | `.naiv4vibe` file picker | none | none | Loads a Vibe Transfer file and fills in the two fields below. |
| Vibe Model | `NAIImgConfig.vibe_model_selection` | (set on upload) | built from the content of the uploaded file | |
| Information Extracted | `NAIImgConfig.InfoExtracted` | 1 | built from the content of the uploaded file | Which pre-computed encoding strength to use. |
| Reference Strength Multiple | `NAIImgConfig.reference_strength_multiple[0]` | set to 0.7 on the first upload | 0–1, step 0.1 | |
| Character reference image | image file (jpg/jpeg/png/webp) | blank | none | If it is blank, the app falls back to the own default image of the character. The page shows it only for nai-diffusion-4-5-full/curated. |
| Style Aware | checkbox | off | none | |
| Use SMEA | checkbox | on | none | The page shows it only for nai-diffusion-3/furry-3/2 with a sampler other than `ddim_v3`. |
| Use DYN | checkbox | off | none | The page shows it only for nai-diffusion-3 with a sampler other than `ddim_v3`. |
| Variety+ | checkbox | off | none | The page shows it for v4/v4.5-full/curated and v3/furry-3. |
| Decrisp | checkbox | off | none | The page shows it for v3/furry-3/v2. |
| Use legacy uc | checkbox | off | none | The page shows it only for nai-diffusion-4-full/4-curated-preview. |
| Enable I2I | `NAII2I` (checkbox) | off | none | Turns on image-to-image. Reveals the next three controls. |
| (I2I) source image | image file | blank | none | If it is blank, the app falls back to the default image of the character. |
| (I2I) Strength | `NAIImgConfig.strength` | 0.6 | 0–0.99, step 0.01 | |
| (I2I) Noise | `NAIImgConfig.noise` | 0.0 | 0–0.99, step 0.01 | |
<!-- src/lib/Setting/Pages/OtherBotSettings.svelte:308-638; src/ts/process/stableDiff.ts:123-357 -->

### Dall-E

| Label | Field | Default | Options | Notes |
|---|---|---|---|---|
| OpenAI API Key | `openAIKey` | empty | free text | The same stored key as the OpenAI Key of TTS. |
| Dall-E Quality | `dallEQuality` | `standard` | standard, hd | |

This panel offers no controls for the request URL, the size, or the model. The app does not expose them as settings for this provider.
<!-- src/lib/Setting/Pages/OtherBotSettings.svelte:642-652; src/ts/process/stableDiff.ts:390-431 -->

### Stability API

| Label | Field | Default | Options | Notes |
|---|---|---|---|---|
| Stability API Key | `stabilityKey` | empty until you set it | free text | |
| Stability Model | `stabilityModel` | `sd3-large` | SD Ultra (`ultra`), SD Core (`core`), SD3 Large (`sd3-large`), SD3 Medium (`sd3-medium`) | |
| SD Core Style | `stabllityStyle` | Unspecified | Unspecified plus 17 style presets (3d-model, analog-film, anime, cinematic, comic-book, digital-art, enhance, fantasy-art, isometric, line-art, low-poly, modeling-compound, neon-punk, origami, photographic, pixel-art, tile-texture) | The page shows it only when Model is SD Core. |
<!-- src/lib/Setting/Pages/OtherBotSettings.svelte:654-689 (Model options :660-663); src/ts/process/stableDiff.ts:433-483 -->

### ComfyUI (and legacy ComfyUI)

| Label | Field | Default | Notes |
|---|---|---|---|
| ComfyUI Request URL | `comfyUiUrl` | `http://localhost:8188` | |
| Workflow | `comfyConfig.workflow` | empty | The API workflow JSON for ComfyUI, for the current provider only. It must include the `risu_prompt` placeholder so that the app inserts the prompt text. |
| Timeout (sec) | `comfyConfig.timeout` | 30 | 1–120. |
| Positive/Negative Text Node ID and Input Field Name (4 text fields) | `comfyConfig.posNodeID`, `posInputName`, `negNodeID`, `negInputName` | empty, `text`, empty, `text` | For the legacy provider only. The current ComfyUI panel does not expose these. |

The legacy panel also shows static notes. One says that the app uses the first image that the prompt generates. The other says (web build only) that you must run ComfyUI with `--enable-cors-header`.
<!-- src/lib/Setting/Pages/OtherBotSettings.svelte:691-722; src/ts/process/stableDiff.ts:485-583 -->

### Fal.ai

| Label | Field | Default | Options | Notes |
|---|---|---|---|---|
| Fal.ai API Key | `falToken` | empty until you set it | free text | |
| Width / Height | `sdConfig.width/height` | 512 / 512 | 0–2048 | The same stored fields as the WebUI panel. |
| Model | `falModel` | `fal-ai/flux/dev` | Flux[Dev], Flux[Dev] with Lora, Flux[Pro], Flux[Schnell] | |
| Lora Model URL | `falLora` | empty until you set it | free text | The page shows it only for the Lora model. It accepts a direct download link or a CivitAI AIR identifier. You must first convert a Google Drive share link to a direct link (for example with gdocs2direct). |
| Lora Weight | `falLoraScale` | 1 | 0–2, step 0.01 | |
<!-- src/lib/Setting/Pages/OtherBotSettings.svelte:724-750; src/ts/process/stableDiff.ts:618-677 -->

### Imagen

| Label | Field | Default | Options | Notes |
|---|---|---|---|---|
| GoogleAI API Key | `google.accessToken` | none | free text | **Hide API Keys** masks it. |
| Model | `ImagenModel` | `imagen-4.0-generate-001` | Imagen 4, Imagen 4 Ultra, Imagen 4 Fast, Imagen 3.0 | |
| Image size | `ImagenImageSize` | `1K` | 1K, 2K | The page shows it only for the two 4.0 models that are not Fast. Imagen 4 Fast has no size control. |
| Aspect ratio | `ImagenAspectRatio` | `1:1` | 1:1, 3:4, 4:3, 9:16, 16:9 | |
| Person generation | `ImagenPersonGeneration` | `allow_all` | allow_all, allow_adult, dont_allow | |
<!-- src/lib/Setting/Pages/OtherBotSettings.svelte:752-787; src/ts/process/stableDiff.ts:678-726 -->

### OpenAI Compatible

| Label | Field | Default | Options | Notes |
|---|---|---|---|---|
| API URL | `openaiCompatImage.url` | empty | free text | |
| API Key | `openaiCompatImage.key` | empty | free text | **Hide API Keys** masks it. |
| Model | `openaiCompatImage.model` | empty | free text | |
| Image Size | `openaiCompatImage.size` | `1024x1024` | 1024x1024, 1536x1024, 1024x1536, 512x512, 256x256 | |
| Quality | `openaiCompatImage.quality` | `auto` | auto, low, medium, high | |
<!-- src/lib/Setting/Pages/OtherBotSettings.svelte:789-815; src/ts/process/stableDiff.ts:727-784 -->

### WaveSpeedAI

| Label | Field | Default | Notes |
|---|---|---|---|
| API Key | `wavespeedImage.key` | empty | **Hide API Keys** masks it. The app uses it both for the model list and for image generation. |
| Refresh Models (button) | none (not saved) | none | Fetches the current model catalog of WaveSpeedAI, keeps only text-to-image and image-to-image models, and fills the Model dropdown. |
| Search models | none (not saved) | none | Filters the Model dropdown by a match of your search terms against the name and ID of each model. |
| Model | `wavespeedImage.model` | empty | The options come from the fetched catalog. If the app has not fetched one yet, the page shows only the model ID that is already saved. If you switch to a model without support for image input, the app clears the reference-image fields below. If you switch to a model without support for LoRA, the app clears the LoRA fields. |
| LoRAs (up to 3) | `wavespeedImage.loras` | none | Each slot has a URL field and a scale slider (0–4, step 0.1). The page shows them only if the selected model supports LoRA. The app does not save blank URLs. |
| Image Reference | `wavespeedImage.reference_mode` | None | None, Upload Image, Use Character Image. The page shows it only if the selected model supports image input. |
| Upload Image | `wavespeedImage.reference_image` (jpg/jpeg/png/webp) | empty | The reference image for image-to-image. The page shows it when Image Reference is Upload Image. |
<!-- src/lib/Setting/Pages/OtherBotSettings.svelte:817-940 -->
