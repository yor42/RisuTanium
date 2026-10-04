# Settings: Chat Bot

Part of [[Settings]]. Open **Settings → Chat Bot**. The page has four tabs: **Model**, **Parameters**, **Prompt** and **Others**. With **Use Legacy GUI** on (Settings → Display & Audio), the tab bar disappears and all four sections are simply shown stacked, one after another, with no tab bar and no per-tab collapse.
<!-- src/lib/Setting/Pages/BotSettings.svelte:113,157,486,621,828 -->

Two mechanics apply across most of this page:

- **Disableable sliders.** A slider with a checkbox on its left (Temperature, Top K, Top P, Min P, Top A, Repetition/Frequency/Presence Penalty, Thinking Tokens, and the per-mode copies under Separate Parameters) stores a number. Unchecking the box does not set the value to 0 — it stores a sentinel that every request builder recognizes as "leave this parameter out of the request entirely." Checking it again restores your last value.
<!-- src/lib/UI/GUI/SliderInput.svelte:16-23,106-109; src/ts/setting/types.ts:71; src/ts/process/request/shared.ts:262-269,336-338 -->
- **Temperature, Frequency Penalty and Presence Penalty are stored as 0–200 but sent as 0.00–2.00.** The slider shows two decimal places; the number saved and the number actually sent to the provider is that shown value, produced by dividing the stored integer by 100. Repetition Penalty is a separate field and does not use this scaling — it's stored and sent directly as 0.00–2.00.
<!-- src/ts/setting/botSettingsParamsData.ts:51-68,75-104,253-267; src/ts/process/request/request.ts:458,672,805,898; src/ts/process/request/shared.ts:285-288,286,293-294,322-328,323,327 -->

---

## Model tab

**Model** and **Auxiliary Model** sit above everything else and are always shown. Auxiliary Model is used for memory, emotion, translation and other background calls when **Separate Models for Auxiliary Models** (see [Auxiliary Model Selectors](#auxiliary-model-selectors) below) is off.

| Setting | Field | Default | Range/options | Shown when | What it does |
|---|---|---|---|---|---|
| Model | `db.aiModel` | `gemini-3-flash-preview` | every model id the app knows | always | Picks the primary provider and model. This choice drives which of the fields below appear. |
| Auxiliary Model | `db.subModel` | `gemini-3-flash-preview` | same list | always | Model used for background/auxiliary calls when auxiliary models aren't separated out. |
<!-- src/lib/Setting/Pages/BotSettings.svelte:158-162 -->

Everything else on this tab appears only for the matching provider or model.

In any API key field below you can type a ${NAME} reference to an environment variable instead of the key itself. See [[API Keys from Environment Variables]].

### Google Cloud / Vertex AI

| Setting | Field | Default | Range/options | Shown when | What it does |
|---|---|---|---|---|---|
| GoogleAI API Key | `db.google.accessToken` | empty | free text, masked | provider is Google Cloud | Authenticates Gemini API requests. |
| Project ID | `db.google.projectId` | empty | free text | provider is Vertex AI | Google Cloud project id for Vertex AI. |
| Vertex Client Email | `db.vertexClientEmail` | empty | free text | Vertex AI | Service-account email for Vertex AI auth. |
| Vertex Private Key | `db.vertexPrivateKey` | empty | free text, masked | Vertex AI | Service-account private key for Vertex AI auth. |
| Region | `db.vertexRegion` | — | global, us-central1, us-west1 | Vertex AI | Vertex AI region to call. |

Editing any of the four Vertex fields above clears the cached Vertex OAuth token, so the next request re-authenticates from scratch.
<!-- src/lib/Setting/Pages/BotSettings.svelte:164-189; clearVertexToken at BotSettings.svelte:106-110 -->

### NovelList

| Setting | Field | Default | Range/options | Shown when | What it does |
|---|---|---|---|---|---|
| NovelList API Key | `db.novellistAPI` | empty | free text, masked | provider is NovelList | Authenticates NovelList requests. |
<!-- src/lib/Setting/Pages/BotSettings.svelte:191-194 -->

### Mancer

| Setting | Field | Default | Range/options | Shown when | What it does |
|---|---|---|---|---|---|
| Mancer API Key | `db.mancerHeader` | empty | free text, masked | Model/Auxiliary Model starts with `mancer` | Authenticates Mancer / Mancer-compatible requests. |
<!-- src/lib/Setting/Pages/BotSettings.svelte:195-198 -->

### Claude (Anthropic / AWS Bedrock)

| Setting | Field | Default | Range/options | Shown when | What it does |
|---|---|---|---|---|---|
| Claude API Key | `db.claudeAPIKey` | empty | free text, masked | provider is Anthropic or AWS | Authenticates Claude direct-API and Bedrock requests. |
<!-- src/lib/Setting/Pages/BotSettings.svelte:199-203 -->

### Mistral

| Setting | Field | Default | Range/options | Shown when | What it does |
|---|---|---|---|---|---|
| Mistral API Key | `db.mistralKey` | empty | free text, masked | provider is Mistral | Authenticates Mistral requests. |
<!-- src/lib/Setting/Pages/BotSettings.svelte:204-207 -->

### NovelAI

| Setting | Field | Default | Range/options | Shown when | What it does |
|---|---|---|---|---|---|
| NovelAI Bearer Token | `db.novelai.token` | empty | free text | provider is NovelAI | Authenticates NovelAI text generation. |
| Run as Text Adventure | `db.NAIadventure` | off | bool | NovelAI | Switches NAI prompt formatting to adventure-mode framing. |
| Append Name on NAI | `db.NAIappendName` | on | bool | NovelAI | Appends the character's name before its generated turn. |
<!-- src/lib/Setting/Pages/BotSettings.svelte:208-211,428-431; src/ts/process/templates/templates.ts:385-386; src/ts/process/models/nai.ts:21,30,33; src/ts/process/request/request.ts:581 -->

### Reverse Proxy (custom endpoint)

| Setting | Field | Default | Range/options | Shown when | What it does |
|---|---|---|---|---|---|
| URL | `db.forceReplaceUrl` | empty | free text/URL | Model/Auxiliary Model is the Reverse Proxy pseudo-provider | Replaces the request URL with your own endpoint. |
| Proxy Key | `db.proxyKey` | empty | free text, masked | Reverse Proxy | Optional password/bearer sent to your proxy. |
| Proxy Request Model | `db.customProxyRequestModel` | empty | free text | Reverse Proxy | Model name string sent in the request body to your proxy. |
| Format | `db.customAPIFormat` | OpenAI Compatible | OpenAI Compatible, OpenAI Response API, Anthropic Claude, Mistral, Google Cloud, Cohere | Reverse Proxy | Chooses which request/response shape is used for your endpoint. |
| Ooba Mode | `db.reverseProxyOobaMode` | off | bool | Reverse Proxy | Shapes the reverse-proxy request/response as Ooba's format instead. |
<!-- src/lib/Setting/Pages/BotSettings.svelte:212-241,425-426; src/ts/storage/database.svelte.ts:2228 -->

### Cohere

| Setting | Field | Default | Range/options | Shown when | What it does |
|---|---|---|---|---|---|
| Cohere API Key | `db.cohereAPIKey` | empty | free text, masked | provider is Cohere | Authenticates Cohere requests. |
<!-- src/lib/Setting/Pages/BotSettings.svelte:243-245 -->

### Ollama

| Setting | Field | Default | Range/options | Shown when | What it does |
|---|---|---|---|---|---|
| Ollama URL | `db.ollamaURL` | empty | free text | Model/Auxiliary Model is `ollama-hosted` | Base URL of your local/self-hosted Ollama server. |
| Model source | `db.ollamaInputMode` | list | Select from List, Manual Input | `ollama-cloud` | Manual input lets you type an arbitrary cloud model id; list shows a grid fetched from Ollama Cloud. |
| Cloud model (manual/grid) | `db.ollamaCloudModel`, `db.ollamaCloudModelName` | empty | free text or grid pick | `ollama-cloud` | Selects the Ollama Cloud model id, and separately stores its display name when picked from the grid. |
| Local model | `db.ollamaModel` | empty | free text | `ollama-hosted` | Model name sent to your local Ollama server. |
| Ollama API Key | `db.ollamaApiKey` | empty | free text, masked | `ollama-cloud` | Authenticates Ollama Cloud requests. |
| Ollama Format | `db.ollamaRequestFormat` | — | Ollama SDK, OpenAI Compatible, OpenAI Response API, Anthropic Claude | `ollama-cloud` | Chooses the request shape used for Ollama Cloud. |
| Response Streaming (Ollama) | `db.useStreaming` | see [Streaming](#streaming) below | bool | `ollama-cloud` with Ollama SDK format | Same field as the general Response Streaming checkbox, shown a second time in this block. |
| Thinking | `db.ollamaThinkingMode` | — | auto, off, on, low, medium, high | Ollama local, or Ollama Cloud with SDK format | Passed through as Ollama's thinking-mode request field. |
<!-- src/lib/Setting/Pages/BotSettings.svelte:247-335 -->

### NanoGPT

| Setting | Field | Default | Range/options | Shown when | What it does |
|---|---|---|---|---|---|
| NanoGPT API Key | `db.nanogptKey` | empty | free text, masked | Model/Auxiliary Model is `nanogpt` | Authenticates NanoGPT. Clearing it also resets the subscription-endpoint toggle, subscription state, request model and provider fields below. |
| NanoGPT dashboard | — | — | read-only | `nanogpt` | Shows account/subscription info fetched with the key. |
| Use subscription endpoint & models | `db.nanogptUseSubscriptionEndpoint` | off | bool | subscription state is active/grace | Switches to NanoGPT's subscription endpoint and model set; toggling it resets the request model fields below. |
| Model input mode | (page-local, not saved) | list | list/manual | `nanogpt` | Switching mode clears the request model fields. |
| Model (manual/grid) | `db.nanogptRequestModel`, `db.nanogptRequestModelName` | empty | free text or grid pick | `nanogpt` | Grid shows subscription vs. regular models depending on the subscription toggle above. |
| Provider picker | `db.nanogptProvider` | empty | dynamic list | `nanogpt`, non-subscription mode | Pins a specific upstream provider for the chosen model. |
<!-- src/lib/Setting/Pages/BotSettings.svelte:68-80,116-125,337-380 -->

### OpenRouter

| Setting | Field | Default | Range/options | Shown when | What it does |
|---|---|---|---|---|---|
| OpenRouter API Key | `db.openrouterKey` | empty | free text, masked | Model/Auxiliary Model is `openrouter` | Authenticates OpenRouter. |
| Model grid | `db.openrouterRequestModel` | empty | live list from OpenRouter, plus pinned "Free Auto"/"OpenRouter Auto" entries | `openrouter` | Picks the OpenRouter model id or auto-route. |
| Tokenizer | `db.customTokenizer` | empty | every tokenizer the app bundles | Model is `openrouter` or Reverse Proxy | Chooses the local tokenizer used to estimate token counts for context management. |
<!-- src/lib/Setting/Pages/BotSettings.svelte:45-48,383-400 -->

See also the [OpenRouter Settings accordion](#openrouter-settings-accordion) below for routing options.

### OpenAI and OpenAI-compatible providers

| Setting | Field | Default | Range/options | Shown when | What it does |
|---|---|---|---|---|---|
| OpenAI API Key | `db.openAIKey` | empty | free text, masked, placeholder `sk-XXXX...` | provider is OpenAI | Authenticates OpenAI requests. |
| Provider API Key | `db.OaiCompAPIKeys[keyIdentifier]` | empty | free text, masked | any model whose entry declares its own key identifier (for example DeepInfra, DeepSeek) | Per-provider key, keyed by that provider's identifier. A second field appears if Auxiliary Model uses a different key identifier than Model. |
<!-- src/lib/Setting/Pages/BotSettings.svelte:401-414 -->

### Kobold, AI Horde, text-generation-webui / Mancer / Ooba, Echo, and plugin providers

| Setting | Field | Default | Range/options | Shown when | What it does |
|---|---|---|---|---|---|
| Plugin | `db.currentPluginProvider` | empty | empty, or a name from your loaded plugins | Model/Auxiliary Model is `custom` | Chooses which plugin-registered custom AI provider handles the request. |
| Kobold URL | `db.koboldURL` | empty | free text | Model/Auxiliary Model is `kobold` | Base URL of a KoboldAI/KoboldCpp server. |
| Echo Message | `db.echoMessage` | "Echo Message" (shown, not stored) | free text | Model/Auxiliary Model is the Echo developer/testing provider | Literal text returned as the assistant's reply — for testing only. |
| Echo Delay (Seconds) | `db.echoDelay` | 0 | min 0 | Echo provider | Sleeps this many seconds before returning the echoed message. |
| Horde API Key | `db.hordeConfig.apiKey` | empty | free text, masked | Model/Auxiliary Model starts with `horde` | Authenticates the AI Horde crowd-sourced backend. |
| Blocking / Stream Provider URL | `db.textgenWebUIBlockingURL`, `db.textgenWebUIStreamURL` | empty | free text (`https://…`, `wss://…`) | text-generation-webui or Mancer | Two endpoints text-generation-webui exposes. Setting a `wss://` stream URL automatically turns on Response Streaming; the blocking URL is also where Ooba's completion requests are sent. |
| Ooba Provider URL | `db.textgenWebUIBlockingURL` (same field) | empty | free text | Model/Auxiliary Model is plain `ooba` | The same field, shown under a different label for the plain Ooba entry. |
| Chat Format Settings | — | — | — | Horde or Kobold | Shows the same [Chat Format block](#chat-format-block) used elsewhere, for the instruct/chat template Horde and Kobold need. |
<!-- src/lib/Setting/Pages/BotSettings.svelte:435-479 -->

### Streaming

| Setting | Field | Default | Range/options | Shown when | What it does |
|---|---|---|---|---|---|
| Response Streaming | `db.useStreaming` | — | bool | Model or Auxiliary Model supports streaming, and it isn't an Ollama Cloud model | Streams the response as it's generated. For text-generation-webui/Mancer, this is derived automatically from whether the stream URL is `wss://`. |
| Stream Gemini Thoughts | `db.streamGeminiThoughts` | — | bool | Response Streaming is on, and the model supports Gemini's thinking output | Streams Gemini's thinking/reasoning tokens as they arrive. |
<!-- src/lib/Setting/Pages/BotSettings.svelte:100-104,417-422 -->

Auxiliary model pickers (Memory/Translations/Emotion/OtherAx) also show on this tab, at the bottom, when **Auxiliary Model Selectors under Model Settings** is on — see [Auxiliary Model Selectors](#auxiliary-model-selectors) below.
<!-- src/lib/Setting/Pages/BotSettings.svelte:481-483 -->

---

## Parameters tab

### Sampling and generation parameters

| Setting | Field | Default | Range/options | Shown when | What it does |
|---|---|---|---|---|---|
| Max Context Size | `db.maxContext` | 4000 | min 0 | always | Token budget the context/lorebook/memory trimmer works within before a request is sent. |
| Max Response Size | `db.maxResponse` | 300 | min 0, max 2048 | always | Requested maximum output tokens. |
| Seed | `db.generationSeed` | empty | number | Model starts with `gpt`, or is Reverse Proxy/OpenRouter | Deterministic sampling seed. Only sent when the value is greater than 0 — 0 or unset is not sent, even though this field is shown for models that don't all support seeds. |
| Temperature | `db.temperature` | 80 (shown as 0.80) | 0.00–2.00, step 0.01 | model supports temperature | Sampling temperature. See the 0–200 scaling note above. |
| Top K | `db.top_k` | 0 | 0–100, step 1 | model supports top-k | Restricts sampling to the K most likely tokens. |
| Top P | `db.top_p` | 1.00 | 0.00–1.00, step 0.01 | model supports top-p | Nucleus sampling. |
| Min P | `db.min_p` | 0 | 0.00–1.00, step 0.01 | model supports min-p | Minimum-probability sampling cutoff. |
| Top A | `db.top_a` | 0 | 0.00–1.00, step 0.01 | model supports top-a | Top-A (NovelAI-style) sampling. |
| Repetition Penalty | `db.repetition_penalty` | 1 | 0.00–2.00, step 0.01 | model supports it | Penalizes repeated tokens. Stored and sent directly as 0.00–2.00 — this slider does not use the 0–200 scaling above. |
| Frequency Penalty | `db.frequencyPenalty` | 70 (shown as 0.70) | 0.00–2.00, step 0.01 | model supports frequency penalty | See the 0–200 scaling note above. Note the achievable range at the request level is 0.0–2.0, not OpenAI's full −2.0–2.0. |
| Presence Penalty | `db.PresensePenalty` | 70 (shown as 0.70) | 0.00–2.00, step 0.01 | model supports presence penalty | Same 0–200 → 0.00–2.00 scaling. |
| Reasoning Effort | `db.reasoningEffort` | Low (0) | Minimal (−1), Low, Medium, High, XHigh — which of these show up depends on which reasoning-effort variants the model declares | model supports a reasoning-effort parameter | Maps the chosen level to the provider's own effort string. |
| Verbosity | `db.verbosity` | Medium | Low, Medium, High | model supports verbosity | Controls output length/detail on models that expose this (for example GPT-5-class OpenAI models). |
<!-- src/ts/setting/botSettingsParamsData.ts:15-119,209-267,268-304,279-286; src/ts/storage/database.svelte.ts:448,476,477,478,589; src/ts/process/request/request.ts:457,458,670,672,689,805,810,895,898,980,1384,1385; src/ts/process/request/shared.ts:152-168,247-258,285-328 -->

### Thinking / reasoning controls

| Setting | Field | Default | Range/options | Shown when | What it does |
|---|---|---|---|---|---|
| Thinking Mode | `db.thinkingType` | Budget | Off, Budget, Adaptive (Adaptive only if the model supports it) | model supports Claude extended thinking | Chooses Claude's extended-thinking mode. |
| Thinking Tokens | `db.thinkingTokens` | — | −1 to 64000, step 200 | Thinking Mode is Budget and the model supports it | Claude's thinking token budget. Disabling the slider (see the disableable-slider note above) omits the parameter; a value of 0 collapses to no thinking. |
| Adaptive Thinking Effort | `db.adaptiveThinkingEffort` | High | Low, Medium, High, XHigh (XHigh only on supporting models), Max | Thinking Mode is Adaptive | Effort level for Claude's adaptive thinking. If the model doesn't support XHigh, XHigh is quietly downgraded to High. |
| DeepSeek Thinking Mode | `db.deepseekThinkingType` | Off | Off, Enabled | model supports DeepSeek's toggleable reasoning | Turns DeepSeek's reasoning mode on or off. |
| DeepSeek Reasoning Effort | `db.deepseekReasoningEffort` | High | High, Max | DeepSeek Thinking Mode is Enabled | Sets DeepSeek's reasoning-effort request field. |
<!-- src/ts/setting/botSettingsParamsData.ts:126-208; src/ts/process/request/anthropic.ts:358-386; src/ts/process/request/openAI/requests.ts:459-462,1180; src/ts/process/request/shared.ts:330-333 -->

### Legacy provider-specific blocks

These are plain, hand-written fields rather than the data-driven controls above, but live on the same tab.

**Ooba / text-generation-webui / Mancer** (shown for `textgen_webui`, `mancer`, or model ids starting with `local_`/`hf:::`): sliders for Repetition Penalty, Length Penalty, Top K, Top P, Typical P, Top A and No-Repeat N-gram Size (defaults 1.15, 1, 20, 0.9, 1, 0, 0); checkboxes for Do Sample (on), Add BOS Token (on), Ban EOS Token (off), Skip Special Tokens (on) and Use Name Prefix; and a toggleable **Custom Stop Words** list (`db.localStopStrings`), sent as request stop sequences for both streaming and non-streaming requests.
<!-- src/lib/Setting/Pages/BotSettings.svelte:489-554; src/ts/storage/database.svelte.ts:1954-1985; src/ts/process/request/request.ts:663-664,797-798 -->

**NovelAI** (shown when the format is NovelAI): a Starter and a Separator text field (an empty Starter falls back to a built-in symbol), plus sliders for Top P/K/A, Tailfree Sampling, Typical P, Repetition Penalty (with Range and Slope), Frequency/Presence Penalty, Mirostat Learning Rate/Tau, and Cfg Scale. Default values for most of these sliders were not confirmed in source; Cfg Scale, Mirostat Tau and Mirostat Learning Rate fall back to 1, 0 and 1 respectively if a preset never set them.
<!-- src/lib/Setting/Pages/BotSettings.svelte:557-588; src/ts/storage/database.svelte.ts:2193-2195 -->

**NovelList** (shown when the format is NovelList): sliders for Top P, Repetition Penalty (with Range and Slope), Top K, Top A and Typical P (defaults 0.7, 1.0625, 1024, 1.7, 140, 1.0).
<!-- src/lib/Setting/Pages/BotSettings.svelte:590-604; src/ts/storage/database.svelte.ts:1942-1951 -->

### Ooba Settings accordion

Shown when Reverse Proxy's Ooba Mode is on, or Model is plain `ooba`. It exposes one nullable text/number/checkbox field per Ooba request parameter — about 30 fields, plus chat-template-only fields (Mode: instruct/chat/chat-instruct, and Name1/Name2/Context/Greeting/System Message/Chat Instruct Command, which vary by Mode). The instruct-mode variant also duplicates the **Custom Stop Words** list from the Parameters tab.

The chat-template-only fields shape the prompt text itself and aren't part of the request body sent for the completion call. Every other field here (Tokenizer, Min P, Top K, Repetition Penalty and its Range, Typical P, TFS, Top A, Epsilon/Eta Cutoff, Guidance Scale, Penalty Alpha, Mirostat Mode/Tau/Eta, Encoder Repetition Penalty, No-Repeat N-gram Size, Min Length, Num Beams, Length Penalty, Truncation Length, Max Tokens/Second, Negative Prompt, Custom Token Bans, Grammar String, Temperature Last, Do Sample, Early Stopping, Auto Max New Tokens, Ban EOS Token, Add BOS Token, Skip Special Tokens) is forwarded to the request whenever you've given it a value.
<!-- src/lib/Setting/Pages/OobaSettings.svelte:1-162; src/ts/process/request/request.ts:786-861; src/ts/process/prompt.ts:255-289 -->

### OpenRouter Settings accordion

Shown when Model starts with `openrouter`.

| Setting | Field | Default | What it does |
|---|---|---|---|
| Use Fallback | `db.openrouterFallback` | off | Lets OpenRouter fall back to a different upstream provider if a request fails. |
| Use Middle Out | `db.openrouterMiddleOut` | off | Turns on OpenRouter's middle-out context-compression transform. |
| Use Instruction Prompt | `db.useInstructPrompt` | off | Shows the [Chat Format block](#chat-format-block) inline for OpenRouter. |
| Provider Preference Order / Allowed Providers / Ignored Providers | `db.openrouterProvider.order[]`, `.only[]`, `.ignore[]` | empty | Repeatable provider-name lists (with +/− buttons) sent to OpenRouter's provider-routing API. Each list is only sent if it's non-empty. |
<!-- src/lib/Setting/Pages/OpenrouterSettings.svelte:14-100; src/ts/process/request/openAI/requests.ts:420-434 -->

### Separate Parameters

Always at the bottom of the Parameters tab (its own contents are conditionally shown).

| Setting | Field | Default | What it does |
|---|---|---|---|
| Enable Separate Parameters | `db.seperateParametersEnabled` | off | Master toggle. When on, exposes labelled accordions — **Long Term Memory**, **Emotion Images**, **Translator**, **Others** — each with its own copy of the sliders and thinking/reasoning controls above (`db.seperateParameters[mode].*`), used instead of the main Parameters-tab values for that call type. |
| Import/Export (per mode) | — | — | Available inside each per-mode panel via the shared component, but not wired up on this page — the Chat Bot page doesn't offer per-mode import/export buttons even though the underlying component supports them. |
<!-- src/lib/Setting/Pages/SeparateParametersSection.svelte:8-24; src/lib/Others/AllSeperateParameters.svelte:27-122; src/lib/Setting/Pages/ClaudeThinkingSeparateParams.svelte:1-83; src/ts/process/request/shared.ts:179-271; src/lang/en.ts:750,799,847,1222 -->

A fifth accordion also appears here, titled with the raw internal key "overrides" rather than a translated label. `db.seperateParameters` also stores the per-model overrides used by **Separate Parameters by Model**, which is why this extra panel shows up alongside the four named ones. Managing those per-model overrides is done from the Easy Panel (see [[Settings]] → Easy Panel), not documented further here.
<!-- src/lib/Setting/Pages/SeparateParametersSection.svelte:8-24; src/ts/storage/database.svelte.ts:579-581; src/ts/process/request/shared.ts:179-186 -->

---

## Others tab

| Setting | Field | Default | What it does |
|---|---|---|---|
| Bias | `db.bias` (array of text/number pairs) | empty | Logit-bias list, added to the character's own bias list at request time. The number field allows −101 to 100; some providers treat −101 as a strong ban. |
| Additional Parameters | `db.additionalParams` (array of key/value pairs) | empty | Free-form request-body or header overrides. `{{none}}` as a value deletes that key; a `header::` prefix targets a request header instead of the body; a `json::` prefix parses the value as JSON before inserting it; quoted values are unquoted; anything else is auto-typed. **For a normal model this table is only sent if Apply Additional Parameters to All Models is on** ([[Settings Accessibility]]). It's always sent for Reverse Proxy, regardless of that toggle. Custom models (`xcustom:::`, defined on **Advanced Settings → Custom Models**) don't use this table at all — they have their own, separate per-model parameters field. |
| Prompt Template accordion | `db.promptTemplate` | not set | Switches the whole prompt system from the simple Main/Jailbreak/Global Note fields on the Prompt tab to an ordered prompt-template builder. Turning it on for the first time seeds an empty template. Opening this accordion is also how you reach the [Prompt settings sub-page](#prompt-settings). |
| Enable Custom Flags | `db.enableCustomFlags` | off | Replaces the *entire* flag set of whichever model is currently selected with your Custom Flags below — this applies to any recognized model, not only custom/unknown ones. |
| Custom Flags | `db.customFlags` | empty | Toggle buttons, one per capability flag, added to or removed from the list on click. The button list currently covers 24 of the app's 27 known flags; pool support, "no structured output," and one Gemini-thinking variant have no button here and can only be set by importing or hand-editing a preset that already has that value. |
| Module Integration | `db.moduleIntergration` | empty | Comma-separated list of module namespaces to force-enable, regardless of what the character's own module list says. |
| Tools → Search | `db.modelTools` (toggles `search` in the array) | empty | Turns on a web-search tool call. Only consumed by the OpenAI Responses-API request path. |
| Regex Script | `db.presetRegex` | empty | Preset-scoped regex/replace scripts, run alongside the character's and module's own scripts. This is the regex list actually applied to chats from a preset — unlike the separate, unreachable Global Regex page described on [[Settings]]. |
| Icon | `db.botPresets[id].image` | none | Uploads an icon for the current preset (resized to 48×48, JPEG). Shown in the preset list and picker. |
| Presets | — | — | Opens the preset-management modal — see [Presets](#presets) below. |
<!-- src/lib/Setting/Pages/BotSettings.svelte:622-826; src/ts/process/request/shared.ts:47-77; src/ts/process/modules.ts:424-427; src/ts/process/request/openAI/responses.ts:332; src/ts/process/index.svelte.ts:1215; src/ts/setting/accessibilitySettingsData.ts:207-210 -->

---

## Chat Format block

This block is not its own page — it's the same two controls mounted inline in several places: the Model tab (for Horde/Kobold), the OpenRouter accordion (when Use Instruction Prompt is on), and the Ooba accordion.

| Setting | Field | Default | Range/options | What it does |
|---|---|---|---|---|
| Chat Formating | `db.instructChatTemplate` | ChatML | ChatML, Llama3, GPT2, Gemma, Mistral, Llama2, Vicuna, Alpaca, Custom (Jinja) | Picks the instruct/chat prompt-formatting template used for local-model style providers. |
| Jinja Template | `db.JinjaTemplate` | empty | free text | Shown only when Chat Formating is set to Custom (Jinja). Your own Jinja chat template. |

Because both fields live on the shared database object rather than per-model, changing either one anywhere it's shown changes it everywhere it's shown.
<!-- src/ts/setting/chatFormatSettingsData.ts:9-38; src/lib/Setting/Pages/BotSettings.svelte:477-479,552; src/lib/Setting/Pages/OpenrouterSettings.svelte:99; src/lib/Setting/Pages/OobaSettings.svelte:22; src/ts/storage/database.svelte.ts:480,2093-2094,2219-2220 -->

---

## Prompt tab

Shown when there's no prompt template in use (`!db.promptTemplate`). If a prompt template is active, this tab instead shows the [Prompt settings sub-page](#prompt-settings) inline.

| Setting | Field | Default | What it does |
|---|---|---|---|
| Main Prompt | `db.mainPrompt` | the app's built-in default prompt | The main system/instruction prompt. When Use Prompt Preprocess (below) is on, `db.additionalPrompt` is appended after it. |
| Jailbreak Prompt | `db.jailbreak` | the app's built-in default | Applied only when the character's own jailbreak toggle is on. |
| Global Note | `db.globalNote` | empty | A note applied to every character (an author's-note-style block). |
| Formatting Order | `db.formatingOrder` | main, description, persona prompt, chats, last chat, jailbreak, lorebook, global note, author note | Drag-reorderable list controlling the order these prompt blocks are assembled in. Blocks lower in the list have more effect on the model's output. |
| Use Prompt Preprocess | `db.promptPreprocess` | off | Turns on two things together: appending `db.additionalPrompt` after Main Prompt, and prepending `db.descriptionPrefix` to the character description. Both of those fields live on [[Settings Advanced]], not on this page. |
<!-- src/lib/Setting/Pages/BotSettings.svelte:830-843; src/ts/process/index.svelte.ts:492,526,1281 -->

---

## Prompt settings

Reached either by opening the **Prompt Template** accordion on the Others tab once a prompt template is in use, or automatically shown on the Prompt tab in that case. This is a sub-page of the Chat Bot settings, not its own sidebar entry. See [[Prompt Template]] for what the prompt-template builder itself does; this section only covers the settings shown alongside it.

| Setting | Field | Default | What it does |
|---|---|---|---|
| Post End (Inner Format) | `db.promptSettings.postEndInnerFormat` | empty | Extra system-role content appended right after the chat-history block, when a prompt template is in use. |
| Send Chat as System | `db.promptSettings.sendChatAsSystem` | off | Forces chat-history messages to the system role instead of user/assistant, unless the character card is flagged to keep the original role. |
| Format Group in Single | `db.promptSettings.sendName` | off | In group chat, wraps each character's turn in its own inner-format template, and changes whether the non-speaker role setting below also applies to the speaker. |
| Trim 'Start New Chat' Messages | `db.promptSettings.trimStartNewChat` | off | When off, a `[Start a new chat]` system marker is added to the request (never for NovelAI models). Turning this on leaves that marker out instead. |
| Utility Override | `db.promptSettings.utilOverride` | off | Together with a prompt template in use, suppresses the character's own utility-bot behavior. |
| Enable Schema (JSON) | `db.jsonSchemaEnabled` | off | Master switch for structured-output/JSON-schema requests, checked independently by every provider's request builder, and also gates whether the response is post-processed with Extract JSON below. |
| Output Image Modal | `db.outputImageModal` | off | Passed through to the request as an image-response flag. |
| Strict Schema | `db.strictJsonSchema` | on | Sets the "strict" flag on the generated JSON schema. |
| Custom Chain of Thought | `db.promptSettings.customChainOfThought` (checkbox) | off | Shown only with **Show Unrecommended** on. The app's own help text for this field says it's no longer recommended. |
| Max Thought Tag Depth | `db.promptSettings.maxThoughtTagDepth` | −1 | Depth limit for nested think-style tags. |
| Non-Speaker Role in Group | `db.groupOtherBotRole` | User | User, System, Assistant | Role assigned to non-speaking characters' turns in group chat. Setting it to Assistant also makes Format Group in Single apply to the speaker. |
| Custom Toggles | `db.customPromptTemplateToggle` | empty | `var=name` lines, one per line, defining custom prompt toggles usable as `getglobalvar::toggle_<var>` in CBS. |
| Default Variables | `db.templateDefaultVariables` | empty | `name=value` lines defining default template variables. A character's own default variable of the same name wins if both exist. |
| Predicted Output | `db.OAIPrediction` | empty | Sent as OpenAI's "predicted output" content, when non-empty. |
| Auto Suggest | `db.autoSuggestPrompt` | empty (the text shown in the box is only a placeholder, not a saved default) | Prompt used for the auto-suggest feature. |
| Non-Speaker Inner Format | `db.groupTemplate` | empty | Overrides the default per-character wrapper for non-speakers in group chat; falls back to a built-in template when empty. Also applies to the speaker if Non-Speaker Role in Group is set to Assistant. |
| System Content Replacement | `db.systemContentReplacement` | `system: {{slot}}` | The prompt format that replaces a system prompt if the model doesn't support one; `{{slot}}` in it is replaced with the original system prompt content (only its first occurrence). Applies only to models without the "full system prompt" capability. On a model that supports only a first system prompt, the leading run of system messages is kept as-is; every other system message gets this treatment. If the format has no `{{slot}}`, the original content is dropped. An empty field falls back to a plain `system: <content>` prefix instead. |
| System Role Replacement | `db.systemRoleReplacement` | User | Role substituted for `system` in that same replacement step. Options: User, Assistant. |
| JSON Schema | `db.jsonSchema` | empty | Interface-style schema text, converted into the request's schema object. |
| Extract JSON | `db.extractJson` | empty | A dotted path (for example `response.text.0`) applied to the raw response text to pull out the final answer, when JSON-schema mode is active. |
<!-- src/lib/Setting/Pages/PromptSettings.svelte:259-306,272,279-283,294-299; src/ts/storage/database.svelte.ts:444,569; src/ts/process/index.svelte.ts:438,492,526,788-791,864,898,937,1044-1053,1061,1281,1388-1391,1467,1622; src/ts/process/request/anthropic.ts:543,1200; src/ts/process/request/google.ts:525,618,1089; src/ts/process/request/openAI/requests.ts:405,689,701,852,1014,1111; src/ts/process/request/openAI/responses.ts:363,451,608; src/ts/process/request/request.ts:348-374,427-428; src/ts/process/templates/jsonSchema.ts:128-149; src/lang/en.ts:249 -->

### Auxiliary Model Selectors

Shown here when **Auxiliary Model Selectors under Model Settings** is off, or on the Model tab (see above) when it's on.

| Setting | Field | Default | What it does |
|---|---|---|---|
| Separate Models for Auxiliary Models | `db.seperateModelsForAxModels` | off | Master toggle: use a distinct model per auxiliary purpose instead of Auxiliary Model for all of them. |
| Do Not Change Separate Models on Preset Change | `db.doNotChangeSeperateModels` | off | When on, switching presets no longer overwrites your separate-model choices from the loaded preset, and saving the current preset stores this state as "off" with the models cleared. |
| Memory / Translations / Emotion / OtherAx | `db.seperateModels.{memory,translate,emotion,otherAx}` | empty each | Per-purpose model override, only used when Separate Models for Auxiliary Models is on. |
<!-- src/lib/Setting/Pages/Model/AuxModelSelectors.svelte:9-28; src/ts/storage/database.svelte.ts:2117-2118,2241-2249 -->

### Fallback Model

| Setting | Field | Default | What it does |
|---|---|---|---|
| Fallback When Blank Response | `db.fallbackWhenBlankResponse` | off | If a request "succeeds" but returns a blank response, and a fallback model list has more entries left, advances to the next fallback model instead of accepting the blank reply. |
| Do Not Change Fallback Models on Preset Change | `db.doNotChangeFallbackModels` | off | Skips overwriting your fallback-model lists when you switch presets. |
| Fallback lists (Model / Memory / Translate / Emotion / OtherAx) | `db.fallbackModels.{model,memory,translate,emotion,otherAx}` | empty each | Ordered lists of models to try, per call type, with +/− buttons. |
<!-- src/lib/Setting/Pages/PromptSettings.svelte:312-352; src/ts/process/request/request.ts:207-224,309 -->

---

## Presets

Click **Presets** on the Others tab to open the preset-management modal.

| Action | What it does |
|---|---|
| Select a preset | Saves everything currently on this page into the preset you're leaving, then loads the clicked preset's values onto the page. |
| Rename (edit mode) | Type directly into the preset's name field. |
| Reorder | Drag and drop a row to move it; the currently-selected preset stays selected even if its position changes. |
| Copy | Saves the current preset, then duplicates the clicked one with " Copy" appended to its name. Does not switch to the copy. |
| Export | Saves the current preset first, then offers a plain download (a compressed, encrypted `.risup` file) or upload to Realm. Choosing RisuRealm asks you to accept upstream RisuAI's terms first, if you haven't already; declining uploads nothing. **Exported presets never include your API keys or private URLs** — OpenAI API Key, the Reverse Proxy URL and its secondary URL, Proxy Key, and the text-generation-webui blocking/stream URLs are stripped before export. |
| Delete | Confirms first, and is blocked if it's the only preset. Switches to the first preset (saving your current edits first, as any switch does), removes the chosen preset, then reloads the first preset's values. |
| Add new preset | Adds a new preset cloned from the app's bundled "OAI2" preset, named "New Preset". Does not switch to it. |
| Import | Loads a preset from a file (plain JSON, or the encrypted `.risup` format) and adds it as a new preset. |
| Diff | Shown only when **Show Prompt Comparison** (Display & Audio settings) is on. Click two presets in sequence to open a side-by-side comparison. |
<!-- src/lib/Setting/botpreset.svelte:28-326,228-234,244-262,296-301; src/ts/storage/database.svelte.ts:2139-2157,2159-2277,2293-2398 -->

**Live edits and presets.** Changing any control on this page (temperature, model, and so on) saves to the app's overall database immediately. It is only copied into the *saved preset entry* when you switch presets, copy a preset, or export one. Switching a preset always saves first, so this never loses your last edits under normal use — but if you close the app without switching, copying or exporting, the stored preset itself is a step behind your last live edits.
<!-- src/ts/storage/database.svelte.ts:2140,2150,2294; src/ts/storage/dbChangeEffects.svelte.ts -->

**Quick switch.** Ctrl+1 through Ctrl+9 switch to the 1st through 9th preset from anywhere in the app, not just this settings page — each press saves the current preset first, exactly like clicking a preset row, and shows a toast naming the preset you switched to. It's suppressed while any modal is open. The button/footer text in the app doesn't state an upper limit, but the hotkey only ever reaches the first 9 presets — a 10th or later preset has no keyboard shortcut.
<!-- src/ts/hotkey.ts:188-244,418-427 -->
