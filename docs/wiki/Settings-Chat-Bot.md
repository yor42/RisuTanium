# Settings: Chat Bot

This page belongs to [[Settings]]. To open it, go to **Settings → Chat Bot**. The page has four tabs: **Model**, **Parameters**, **Prompt**, and **Others**. When **Use Legacy GUI** is on (Settings → Display & Audio), the tab bar disappears. The page then shows all four sections stacked one after another. It shows no tab bar and no collapse for each tab.
<!-- src/lib/Setting/Pages/BotSettings.svelte:113,157,486,621,828 -->

Two mechanics apply across most of this page:

- **Sliders that you can disable.** A slider with a checkbox on its left stores a number. These sliders are Temperature, Top K, Top P, Min P, Top A, Repetition Penalty, Frequency Penalty, Presence Penalty, Thinking Tokens, and the copies for each mode under Separate Parameters. If you uncheck the box, the app does not set the value to 0. It stores a sentinel value. Every request builder recognizes it as "leave this parameter out of the request entirely". If you check the box again, the app restores your last value.
<!-- src/lib/UI/GUI/SliderInput.svelte:16-23,106-109; src/ts/setting/types.ts:71; src/ts/process/request/shared.ts:262-269,336-338 -->
- **The app stores Temperature, Frequency Penalty, and Presence Penalty as 0–200, but it sends them as 0.00–2.00.** The slider shows two decimal places. The number that the app saves, and the number that it sends to the provider, is that shown value. The app produces it when it divides the stored integer by 100. Repetition Penalty is a separate field and does not use this scaling. The app stores and sends it directly as 0.00–2.00.
<!-- src/ts/setting/botSettingsParamsData.ts:51-68,75-104,253-267; src/ts/process/request/request.ts:458,672,805,898; src/ts/process/request/shared.ts:285-288,286,293-294,322-328,323,327 -->

---

## Model tab

**Model** and **Auxiliary Model** sit above everything else, and the page always shows them. The app uses Auxiliary Model for memory, emotion, translation, and other background calls when **Separate Models for Auxiliary Models** is off. See [Auxiliary Model Selectors](#auxiliary-model-selectors) below.

| Setting | Field | Default | Range/options | Shown when | What it does |
|---|---|---|---|---|---|
| Model | `db.aiModel` | `gemini-3-flash-preview` | every model id that the app knows | always | Picks the primary provider and model. This choice decides which of the fields below appear. |
| Auxiliary Model | `db.subModel` | `gemini-3-flash-preview` | the same list | always | The model for background and auxiliary calls when the auxiliary models are not separated. |
<!-- src/lib/Setting/Pages/BotSettings.svelte:158-162 -->

Everything else on this tab appears only for the matching provider or model.

In any API key field below, you can type a ${NAME} reference to an environment variable instead of the key itself. See [[API Keys from Environment Variables]].

### Google Cloud / Vertex AI

| Setting | Field | Default | Range/options | Shown when | What it does |
|---|---|---|---|---|---|
| GoogleAI API Key | `db.google.accessToken` | empty | free text, masked | provider is Google Cloud | Authenticates Gemini API requests. |
| Project ID | `db.google.projectId` | empty | free text | provider is Vertex AI | The Google Cloud project id for Vertex AI. |
| Vertex Client Email | `db.vertexClientEmail` | empty | free text | Vertex AI | The service-account email for Vertex AI auth. |
| Vertex Private Key | `db.vertexPrivateKey` | empty | free text, masked | Vertex AI | The service-account private key for Vertex AI auth. |
| Region | `db.vertexRegion` | none | global, us-central1, us-west1 | Vertex AI | The Vertex AI region to call. |

If you edit any of the four Vertex fields above, the app clears the cached Vertex OAuth token. So the next request authenticates again from scratch.
<!-- src/lib/Setting/Pages/BotSettings.svelte:164-189; clearVertexToken at BotSettings.svelte:106-110 -->

### NovelList

| Setting | Field | Default | Range/options | Shown when | What it does |
|---|---|---|---|---|---|
| NovelList API Key | `db.novellistAPI` | empty | free text, masked | provider is NovelList | Authenticates NovelList requests. |
<!-- src/lib/Setting/Pages/BotSettings.svelte:191-194 -->

### Mancer

| Setting | Field | Default | Range/options | Shown when | What it does |
|---|---|---|---|---|---|
| Mancer API Key | `db.mancerHeader` | empty | free text, masked | Model/Auxiliary Model starts with `mancer` | Authenticates Mancer and Mancer-compatible requests. |
<!-- src/lib/Setting/Pages/BotSettings.svelte:195-198 -->

### Claude (Anthropic / AWS Bedrock)

| Setting | Field | Default | Range/options | Shown when | What it does |
|---|---|---|---|---|---|
| Claude API Key | `db.claudeAPIKey` | empty | free text, masked | provider is Anthropic or AWS | Authenticates requests to the Claude direct API and to Bedrock. |
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
| Run as Text Adventure | `db.NAIadventure` | off | bool | NovelAI | Switches the NAI prompt formatting to the framing of the adventure mode. |
| Append Name on NAI | `db.NAIappendName` | on | bool | NovelAI | Appends the name of the character before its generated turn. |
<!-- src/lib/Setting/Pages/BotSettings.svelte:208-211,428-431; src/ts/process/templates/templates.ts:385-386; src/ts/process/models/nai.ts:21,30,33; src/ts/process/request/request.ts:581 -->

### Reverse Proxy (custom endpoint)

| Setting | Field | Default | Range/options | Shown when | What it does |
|---|---|---|---|---|---|
| URL | `db.forceReplaceUrl` | empty | free text/URL | Model/Auxiliary Model is the Reverse Proxy pseudo-provider | Replaces the request URL with your own endpoint. |
| Proxy Key | `db.proxyKey` | empty | free text, masked | Reverse Proxy | An optional password or bearer token that the app sends to your proxy. |
| Proxy Request Model | `db.customProxyRequestModel` | empty | free text | Reverse Proxy | The model name string that the app sends in the request body to your proxy. |
| Format | `db.customAPIFormat` | OpenAI Compatible | OpenAI Compatible, OpenAI Response API, Anthropic Claude, Mistral, Google Cloud, Cohere | Reverse Proxy | Chooses which shape of request and response the app uses for your endpoint. |
| Ooba Mode | `db.reverseProxyOobaMode` | off | bool | Reverse Proxy | Shapes the request and response of the reverse proxy in the format of Ooba instead. |
<!-- src/lib/Setting/Pages/BotSettings.svelte:212-241,425-426; src/ts/storage/database.svelte.ts:2228 -->

### Cohere

| Setting | Field | Default | Range/options | Shown when | What it does |
|---|---|---|---|---|---|
| Cohere API Key | `db.cohereAPIKey` | empty | free text, masked | provider is Cohere | Authenticates Cohere requests. |
<!-- src/lib/Setting/Pages/BotSettings.svelte:243-245 -->

### Ollama

| Setting | Field | Default | Range/options | Shown when | What it does |
|---|---|---|---|---|---|
| Ollama URL | `db.ollamaURL` | empty | free text | Model/Auxiliary Model is `ollama-hosted` | The base URL of your local or self-hosted Ollama server. |
| Model source | `db.ollamaInputMode` | list | Select from List, Manual Input | `ollama-cloud` | Manual input lets you type any cloud model id. The list shows a grid that the app fetches from Ollama Cloud. |
| Cloud model (manual/grid) | `db.ollamaCloudModel`, `db.ollamaCloudModelName` | empty | free text or grid pick | `ollama-cloud` | Selects the Ollama Cloud model id. When you pick from the grid, it also stores the display name separately. |
| Local model | `db.ollamaModel` | empty | free text | `ollama-hosted` | The model name that the app sends to your local Ollama server. |
| Ollama API Key | `db.ollamaApiKey` | empty | free text, masked | `ollama-cloud` | Authenticates Ollama Cloud requests. |
| Ollama Format | `db.ollamaRequestFormat` | none | Ollama SDK, OpenAI Compatible, OpenAI Response API, Anthropic Claude | `ollama-cloud` | Chooses the shape of the request that the app uses for Ollama Cloud. |
| Response Streaming (Ollama) | `db.useStreaming` | see [Streaming](#streaming) below | bool | `ollama-cloud` with the Ollama SDK format | The same field as the general Response Streaming checkbox. The page shows it a second time in this block. |
| Thinking | `db.ollamaThinkingMode` | none | auto, off, on, low, medium, high | Ollama local, or Ollama Cloud with the SDK format | The app passes it through as the thinking-mode request field of Ollama. |
<!-- src/lib/Setting/Pages/BotSettings.svelte:247-335 -->

### NanoGPT

| Setting | Field | Default | Range/options | Shown when | What it does |
|---|---|---|---|---|---|
| NanoGPT API Key | `db.nanogptKey` | empty | free text, masked | Model/Auxiliary Model is `nanogpt` | Authenticates NanoGPT. If you clear it, the app also resets the toggle for the subscription endpoint, the subscription state, the request model, and the provider fields below. |
| NanoGPT dashboard | none | none | read-only | `nanogpt` | Shows account and subscription info that the app fetches with the key. |
| Use subscription endpoint & models | `db.nanogptUseSubscriptionEndpoint` | off | bool | subscription state is active/grace | Switches to the subscription endpoint and model set of NanoGPT. When you toggle it, the app resets the request model fields below. |
| Model input mode | (local to the page, not saved) | list | list/manual | `nanogpt` | A switch of the mode clears the request model fields. |
| Model (manual/grid) | `db.nanogptRequestModel`, `db.nanogptRequestModelName` | empty | free text or grid pick | `nanogpt` | The grid shows subscription models or regular models, depending on the subscription toggle above. |
| Provider picker | `db.nanogptProvider` | empty | dynamic list | `nanogpt`, non-subscription mode | Pins a specific upstream provider for the chosen model. |
<!-- src/lib/Setting/Pages/BotSettings.svelte:68-80,116-125,337-380 -->

### OpenRouter

| Setting | Field | Default | Range/options | Shown when | What it does |
|---|---|---|---|---|---|
| OpenRouter API Key | `db.openrouterKey` | empty | free text, masked | Model/Auxiliary Model is `openrouter` | Authenticates OpenRouter. |
| Model grid | `db.openrouterRequestModel` | empty | a live list from OpenRouter, plus pinned entries "Free Auto" and "OpenRouter Auto" | `openrouter` | Picks the OpenRouter model id or the auto-route. |
| Tokenizer | `db.customTokenizer` | empty | every tokenizer that the app bundles | Model is `openrouter` or Reverse Proxy | Chooses the local tokenizer that estimates token counts for context management. |
<!-- src/lib/Setting/Pages/BotSettings.svelte:45-48,383-400 -->

For the routing options, see also the [OpenRouter Settings accordion](#openrouter-settings-accordion) below.

### OpenAI and OpenAI-compatible providers

| Setting | Field | Default | Range/options | Shown when | What it does |
|---|---|---|---|---|---|
| OpenAI API Key | `db.openAIKey` | empty | free text, masked, placeholder `sk-XXXX...` | provider is OpenAI | Authenticates OpenAI requests. |
| Provider API Key | `db.OaiCompAPIKeys[keyIdentifier]` | empty | free text, masked | any model whose entry declares its own key identifier (for example DeepInfra, DeepSeek) | A key for each provider, keyed by the identifier of that provider. A second field appears if Auxiliary Model uses a different key identifier than Model. |
<!-- src/lib/Setting/Pages/BotSettings.svelte:401-414 -->

### Kobold, AI Horde, text-generation-webui / Mancer / Ooba, Echo, and plugin providers

| Setting | Field | Default | Range/options | Shown when | What it does |
|---|---|---|---|---|---|
| Plugin | `db.currentPluginProvider` | empty | empty, or a name from your loaded plugins | Model/Auxiliary Model is `custom` | Chooses which custom AI provider, registered by a plugin, handles the request. |
| Kobold URL | `db.koboldURL` | empty | free text | Model/Auxiliary Model is `kobold` | The base URL of a KoboldAI or KoboldCpp server. |
| Echo Message | `db.echoMessage` | "Echo Message" (shown, not stored) | free text | Model/Auxiliary Model is the Echo developer/testing provider | The literal text that the provider returns as the reply of the assistant. For testing only. |
| Echo Delay (Seconds) | `db.echoDelay` | 0 | min 0 | Echo provider | Sleeps this many seconds before it returns the echoed message. |
| Horde API Key | `db.hordeConfig.apiKey` | empty | free text, masked | Model/Auxiliary Model starts with `horde` | Authenticates the crowd-sourced backend of AI Horde. |
| Blocking / Stream Provider URL | `db.textgenWebUIBlockingURL`, `db.textgenWebUIStreamURL` | empty | free text (`https://…`, `wss://…`) | text-generation-webui or Mancer | The two endpoints that text-generation-webui exposes. If you set a stream URL with `wss://`, the app turns on Response Streaming automatically. The blocking URL is also where the app sends the completion requests of Ooba. |
| Ooba Provider URL | `db.textgenWebUIBlockingURL` (same field) | empty | free text | Model/Auxiliary Model is plain `ooba` | The same field, shown under a different label for the plain Ooba entry. |
| Chat Format Settings | none | none | none | Horde or Kobold | Shows the same [Chat Format block](#chat-format-block) that is used elsewhere, for the instruct or chat template that Horde and Kobold need. |
<!-- src/lib/Setting/Pages/BotSettings.svelte:435-479 -->

### Streaming

| Setting | Field | Default | Range/options | Shown when | What it does |
|---|---|---|---|---|---|
| Response Streaming | `db.useStreaming` | none | bool | Model or Auxiliary Model supports streaming, and it is not an Ollama Cloud model | Streams the response while it is generated. For text-generation-webui and Mancer, the app derives this automatically from whether the stream URL is `wss://`. |
| Stream Gemini Thoughts | `db.streamGeminiThoughts` | none | bool | Response Streaming is on, and the model supports the thinking output of Gemini | Streams the thinking and reasoning tokens of Gemini while they arrive. |
<!-- src/lib/Setting/Pages/BotSettings.svelte:100-104,417-422 -->

The pickers for auxiliary models (Memory, Translations, Emotion, OtherAx) also show on this tab, at the bottom, when **Auxiliary Model Selectors under Model Settings** is on. See [Auxiliary Model Selectors](#auxiliary-model-selectors) below.
<!-- src/lib/Setting/Pages/BotSettings.svelte:481-483 -->

---

## Parameters tab

### Sampling and generation parameters

| Setting | Field | Default | Range/options | Shown when | What it does |
|---|---|---|---|---|---|
| Max Context Size | `db.maxContext` | 4000 | min 0 | always | The token budget within which the trimmer for context, lorebook, and memory works before the app sends a request. |
| Max Response Size | `db.maxResponse` | 300 | min 0, max 2048 | always | The maximum number of output tokens that the app requests. |
| Seed | `db.generationSeed` | empty | number | Model starts with `gpt`, or is Reverse Proxy/OpenRouter | A seed for deterministic sampling. The app sends it only when the value is greater than 0. The app does not send 0 or an unset value. The page shows this field for models that do not all support seeds. |
| Temperature | `db.temperature` | 80 (shown as 0.80) | 0.00–2.00, step 0.01 | model supports temperature | The sampling temperature. See the note about the 0–200 scaling above. |
| Top K | `db.top_k` | 0 | 0–100, step 1 | model supports top-k | Restricts sampling to the K most likely tokens. |
| Top P | `db.top_p` | 1.00 | 0.00–1.00, step 0.01 | model supports top-p | Nucleus sampling. |
| Min P | `db.min_p` | 0 | 0.00–1.00, step 0.01 | model supports min-p | The cutoff for minimum-probability sampling. |
| Top A | `db.top_a` | 0 | 0.00–1.00, step 0.01 | model supports top-a | Top-A sampling (NovelAI style). |
| Repetition Penalty | `db.repetition_penalty` | 1 | 0.00–2.00, step 0.01 | model supports it | Penalizes repeated tokens. The app stores and sends it directly as 0.00–2.00. This slider does not use the 0–200 scaling above. |
| Frequency Penalty | `db.frequencyPenalty` | 70 (shown as 0.70) | 0.00–2.00, step 0.01 | model supports frequency penalty | See the note about the 0–200 scaling above. Note that the range that you can reach at the request level is 0.0–2.0. It is not the full range −2.0–2.0 of OpenAI. |
| Presence Penalty | `db.PresensePenalty` | 70 (shown as 0.70) | 0.00–2.00, step 0.01 | model supports presence penalty | The same scaling from 0–200 to 0.00–2.00. |
| Reasoning Effort | `db.reasoningEffort` | Low (0) | Minimal (−1), Low, Medium, High, XHigh. Which of these appear depends on which variants of reasoning effort the model declares. | model supports a reasoning-effort parameter | Maps the chosen level to the own effort string of the provider. |
| Verbosity | `db.verbosity` | Medium | Low, Medium, High | model supports verbosity | Controls the length and detail of the output on models that expose this (for example GPT-5-class OpenAI models). |
<!-- src/ts/setting/botSettingsParamsData.ts:15-119,209-267,268-304,279-286; src/ts/storage/database.svelte.ts:448,476,477,478,589; src/ts/process/request/request.ts:457,458,670,672,689,805,810,895,898,980,1384,1385; src/ts/process/request/shared.ts:152-168,247-258,285-328 -->

### Thinking / reasoning controls

| Setting | Field | Default | Range/options | Shown when | What it does |
|---|---|---|---|---|---|
| Thinking Mode | `db.thinkingType` | Budget | Off, Budget, Adaptive (Adaptive only if the model supports it) | model supports Claude extended thinking | Chooses the extended-thinking mode of Claude. |
| Thinking Tokens | `db.thinkingTokens` | none | −1 to 64000, step 200 | Thinking Mode is Budget and the model supports it | The thinking token budget of Claude. If you disable the slider (see the note about sliders that you can disable above), the app omits the parameter. A value of 0 collapses to no thinking. |
| Adaptive Thinking Effort | `db.adaptiveThinkingEffort` | High | Low, Medium, High, XHigh (XHigh only on models that support it), Max | Thinking Mode is Adaptive | The effort level for the adaptive thinking of Claude. If the model does not support XHigh, the app quietly downgrades XHigh to High. |
| DeepSeek Thinking Mode | `db.deepseekThinkingType` | Off | Off, Enabled | model supports the reasoning of DeepSeek that you can toggle | Turns the reasoning mode of DeepSeek on or off. |
| DeepSeek Reasoning Effort | `db.deepseekReasoningEffort` | High | High, Max | DeepSeek Thinking Mode is Enabled | Sets the request field for the reasoning effort of DeepSeek. |
<!-- src/ts/setting/botSettingsParamsData.ts:126-208; src/ts/process/request/anthropic.ts:358-386; src/ts/process/request/openAI/requests.ts:459-462,1180; src/ts/process/request/shared.ts:330-333 -->

### Legacy provider-specific blocks

These are plain fields that someone wrote by hand. They are not data-driven controls like the ones above. But they live on the same tab.

**Ooba / text-generation-webui / Mancer** (shown for `textgen_webui`, `mancer`, or model ids that start with `local_` or `hf:::`):
- Sliders for Repetition Penalty, Length Penalty, Top K, Top P, Typical P, Top A, and No-Repeat N-gram Size (defaults 1.15, 1, 20, 0.9, 1, 0, 0).
- Checkboxes for Do Sample (on), Add BOS Token (on), Ban EOS Token (off), Skip Special Tokens (on), and Use Name Prefix.
- A **Custom Stop Words** list that you can toggle (`db.localStopStrings`). The app sends it as stop sequences of the request for both streaming and non-streaming requests.

<!-- src/lib/Setting/Pages/BotSettings.svelte:489-554; src/ts/storage/database.svelte.ts:1954-1985; src/ts/process/request/request.ts:663-664,797-798 -->

**NovelAI** (shown when the format is NovelAI): A Starter text field and a Separator text field. An empty Starter falls back to a built-in symbol. It also has sliders for Top P/K/A, Tailfree Sampling, Typical P, Repetition Penalty (with Range and Slope), Frequency/Presence Penalty, Mirostat Learning Rate/Tau, and Cfg Scale. The authors did not confirm the default values of most of these sliders in the source. If a preset never set them, Cfg Scale, Mirostat Tau, and Mirostat Learning Rate fall back to 1, 0, and 1.
<!-- src/lib/Setting/Pages/BotSettings.svelte:557-588; src/ts/storage/database.svelte.ts:2193-2195 -->

**NovelList** (shown when the format is NovelList): Sliders for Top P, Repetition Penalty (with Range and Slope), Top K, Top A, and Typical P (defaults 0.7, 1.0625, 1024, 1.7, 140, 1.0).
<!-- src/lib/Setting/Pages/BotSettings.svelte:590-604; src/ts/storage/database.svelte.ts:1942-1951 -->

### Ooba Settings accordion

The page shows it when Ooba Mode of Reverse Proxy is on, or when Model is plain `ooba`. It exposes one field for each request parameter of Ooba. Each field can be empty, and each is a text, number, or checkbox field. There are about 30 fields. There are also fields that exist only for the chat template: Mode (instruct, chat, or chat-instruct), and Name1, Name2, Context, Greeting, System Message, and Chat Instruct Command, which vary by Mode. The instruct-mode variant also duplicates the **Custom Stop Words** list from the Parameters tab.

The fields that exist only for the chat template shape the prompt text itself. They are not part of the request body that the app sends for the completion call. The app forwards every other field to the request whenever you gave it a value. These fields are: Tokenizer, Min P, Top K, Repetition Penalty and its Range, Typical P, TFS, Top A, Epsilon/Eta Cutoff, Guidance Scale, Penalty Alpha, Mirostat Mode/Tau/Eta, Encoder Repetition Penalty, No-Repeat N-gram Size, Min Length, Num Beams, Length Penalty, Truncation Length, Max Tokens/Second, Negative Prompt, Custom Token Bans, Grammar String, Temperature Last, Do Sample, Early Stopping, Auto Max New Tokens, Ban EOS Token, Add BOS Token, and Skip Special Tokens.
<!-- src/lib/Setting/Pages/OobaSettings.svelte:1-162; src/ts/process/request/request.ts:786-861; src/ts/process/prompt.ts:255-289 -->

### OpenRouter Settings accordion

The page shows it when Model starts with `openrouter`.

| Setting | Field | Default | What it does |
|---|---|---|---|
| Use Fallback | `db.openrouterFallback` | off | Lets OpenRouter fall back to a different upstream provider if a request fails. |
| Use Middle Out | `db.openrouterMiddleOut` | off | Turns on the middle-out context-compression transform of OpenRouter. |
| Use Instruction Prompt | `db.useInstructPrompt` | off | Shows the [Chat Format block](#chat-format-block) inline for OpenRouter. |
| Provider Preference Order / Allowed Providers / Ignored Providers | `db.openrouterProvider.order[]`, `.only[]`, `.ignore[]` | empty | Provider-name lists that you can repeat (with +/− buttons). The app sends them to the provider-routing API of OpenRouter. The app sends each list only if it is not empty. |
<!-- src/lib/Setting/Pages/OpenrouterSettings.svelte:14-100; src/ts/process/request/openAI/requests.ts:420-434 -->

### Separate Parameters

This section is always at the bottom of the Parameters tab. Its own contents are shown under conditions.

| Setting | Field | Default | What it does |
|---|---|---|---|
| Enable Separate Parameters | `db.seperateParametersEnabled` | off | The master toggle. When it is on, it exposes accordions with labels: **Long Term Memory**, **Emotion Images**, **Translator**, and **Others**. Each has its own copy of the sliders and of the thinking and reasoning controls above (`db.seperateParameters[mode].*`). The app uses them instead of the values on the main Parameters tab for that type of call. |
| Import/Export (per mode) | none | none | The shared component makes it available inside each panel for a mode. But this page does not wire it up. The Chat Bot page does not offer buttons for import and export for each mode, even though the underlying component supports them. |
<!-- src/lib/Setting/Pages/SeparateParametersSection.svelte:8-24; src/lib/Others/AllSeperateParameters.svelte:27-122; src/lib/Setting/Pages/ClaudeThinkingSeparateParams.svelte:1-83; src/ts/process/request/shared.ts:179-271; src/lang/en.ts:750,799,847,1222 -->

A fifth accordion also appears here. Its title is the raw internal key "overrides", not a translated label. `db.seperateParameters` also stores the overrides for each model that **Separate Parameters by Model** uses. This is why this extra panel shows up next to the four named ones. You manage those overrides for each model from the Easy Panel (see [[Settings]] → Easy Panel). This page does not document them further.
<!-- src/lib/Setting/Pages/SeparateParametersSection.svelte:8-24; src/ts/storage/database.svelte.ts:579-581; src/ts/process/request/shared.ts:179-186 -->

---

## Others tab

| Setting | Field | Default | What it does |
|---|---|---|---|
| Bias | `db.bias` (array of text/number pairs) | empty | A list of logit bias. The app adds it to the own bias list of the character at request time. The number field allows −101 to 100. Some providers treat −101 as a strong ban. |
| Additional Parameters | `db.additionalParams` (array of key/value pairs) | empty | Freeform overrides for the request body or header. `{{none}}` as a value deletes that key. A `header::` prefix targets a request header instead of the body. A `json::` prefix parses the value as JSON before the app inserts it. The app removes quotes from quoted values. The app types anything else automatically. **For a normal model, the app sends this table only if Apply Additional Parameters to All Models is on** ([[Settings Accessibility]]). The app always sends it for Reverse Proxy, whatever that toggle says. Custom models (`xcustom:::`, which you define at **Advanced Settings → Custom Models**) do not use this table at all. They have their own, separate field for parameters for each model. |
| Prompt Template accordion | `db.promptTemplate` | not set | Switches the whole prompt system. The simple fields Main, Jailbreak, and Global Note on the Prompt tab give way to an ordered builder for prompt templates. The first time you turn it on, the app seeds an empty template. You also reach the [Prompt settings sub-page](#prompt-settings) when you open this accordion. |
| Enable Custom Flags | `db.enableCustomFlags` | off | Replaces the *entire* set of flags of the model that is selected now with your Custom Flags below. This applies to any recognized model, not only to custom or unknown models. |
| Custom Flags | `db.customFlags` | empty | Toggle buttons, one for each capability flag. A click adds the flag to the list or removes it. The list of buttons covers 24 of the 27 flags that the app knows now. Three flags have no button here: pool support, "no structured output", and one variant of Gemini thinking. You can set them only if you import or hand-edit a preset that already has that value. |
| Module Integration | `db.moduleIntergration` | empty | A list of module namespaces to force-enable, separated by commas. It applies whatever the own module list of the character says. |
| Tools → Search | `db.modelTools` (toggles `search` in the array) | empty | Turns on a tool call for web search. Only the request path of the OpenAI Responses API uses it. |
| Regex Script | `db.presetRegex` | empty | Regex and replace scripts with the scope of the preset. They run next to the own scripts of the character and of the module. This is the regex list that the app actually applies to chats from a preset. The separate Global Regex page, which you cannot reach, does not do this. See [[Settings]]. |
| Icon | `db.botPresets[id].image` | none | Uploads an icon for the current preset (resized to 48×48, JPEG). The preset list and the picker show it. |
| Presets | none | none | Opens the modal for the management of presets. See [Presets](#presets) below. |
<!-- src/lib/Setting/Pages/BotSettings.svelte:622-826; src/ts/process/request/shared.ts:47-77; src/ts/process/modules.ts:424-427; src/ts/process/request/openAI/responses.ts:332; src/ts/process/index.svelte.ts:1215; src/ts/setting/accessibilitySettingsData.ts:207-210 -->

---

## Chat Format block

This block is not its own page. It is the same two controls, mounted inline in several places: the Model tab (for Horde and Kobold), the OpenRouter accordion (when Use Instruction Prompt is on), and the Ooba accordion.

| Setting | Field | Default | Range/options | What it does |
|---|---|---|---|---|
| Chat Formating | `db.instructChatTemplate` | ChatML | ChatML, Llama3, GPT2, Gemma, Mistral, Llama2, Vicuna, Alpaca, Custom (Jinja) | Picks the template for the formatting of instruct and chat prompts that providers in the style of local models use. |
| Jinja Template | `db.JinjaTemplate` | empty | free text | The page shows it only when Chat Formating is set to Custom (Jinja). Your own Jinja chat template. |

Both fields live on the shared database object. They do not belong to a model. So if you change either one anywhere it is shown, it changes everywhere it is shown.
<!-- src/ts/setting/chatFormatSettingsData.ts:9-38; src/lib/Setting/Pages/BotSettings.svelte:477-479,552; src/lib/Setting/Pages/OpenrouterSettings.svelte:99; src/lib/Setting/Pages/OobaSettings.svelte:22; src/ts/storage/database.svelte.ts:480,2093-2094,2219-2220 -->

---

## Prompt tab

The page shows this tab when no prompt template is in use (`!db.promptTemplate`). If a prompt template is active, this tab shows the [Prompt settings sub-page](#prompt-settings) inline instead.

| Setting | Field | Default | What it does |
|---|---|---|---|
| Main Prompt | `db.mainPrompt` | the built-in default prompt of the app | The main system or instruction prompt. When Use Prompt Preprocess (below) is on, `db.additionalPrompt` is appended after it. |
| Jailbreak Prompt | `db.jailbreak` | the built-in default of the app | It applies only when the own jailbreak toggle of the character is on. |
| Global Note | `db.globalNote` | empty | A note that applies to every character (a block in the style of an author's note). |
| Formatting Order | `db.formatingOrder` | main, description, persona prompt, chats, last chat, jailbreak, lorebook, global note, author note | A list that you can reorder by dragging. It controls the order in which the app assembles these prompt blocks. Blocks lower in the list have more effect on the output of the model. |
| Use Prompt Preprocess | `db.promptPreprocess` | off | Turns on two things together. It appends `db.additionalPrompt` after Main Prompt. It also prepends `db.descriptionPrefix` to the character description. Both of those fields live on [[Settings Advanced]]. They are not on this page. |
<!-- src/lib/Setting/Pages/BotSettings.svelte:830-843; src/ts/process/index.svelte.ts:492,526,1281 -->

---

## Prompt settings

You reach this sub-page in one of two ways. You open the **Prompt Template** accordion on the Others tab once a prompt template is in use. Or the Prompt tab shows it automatically in that case. It is a sub-page of the Chat Bot settings. It is not its own entry in the sidebar. For what the builder of prompt templates itself does, see [[Prompt Template]]. This section covers only the settings that appear next to it.

| Setting | Field | Default | What it does |
|---|---|---|---|
| Post End (Inner Format) | `db.promptSettings.postEndInnerFormat` | empty | Extra content with the system role. The app appends it right after the block of the chat history, when a prompt template is in use. |
| Send Chat as System | `db.promptSettings.sendChatAsSystem` | off | Forces the messages of the chat history to the system role instead of user and assistant. The exception is a character card that is flagged to keep the original role. |
| Format Group in Single | `db.promptSettings.sendName` | off | In a group chat, wraps the turn of each character in its own template for the inner format. It also changes whether the setting for the non-speaker role below applies to the speaker. |
| Trim 'Start New Chat' Messages | `db.promptSettings.trimStartNewChat` | off | When it is off, the app adds a `[Start a new chat]` system marker to the request (never for NovelAI models). When you turn it on, the app leaves that marker out instead. |
| Utility Override | `db.promptSettings.utilOverride` | off | Together with a prompt template that is in use, it suppresses the own behavior of the character as a utility bot. |
| Enable Schema (JSON) | `db.jsonSchemaEnabled` | off | The master switch for requests with structured output or JSON schema. The request builder of every provider checks it independently. It also controls whether the app post-processes the response with Extract JSON below. |
| Output Image Modal | `db.outputImageModal` | off | The app passes it through to the request as a flag for an image response. |
| Strict Schema | `db.strictJsonSchema` | on | Sets the "strict" flag on the generated JSON schema. |
| Custom Chain of Thought | `db.promptSettings.customChainOfThought` (checkbox) | off | The page shows it only with **Show Unrecommended** on. The help text of the app for this field says that it is no longer recommended. |
| Max Thought Tag Depth | `db.promptSettings.maxThoughtTagDepth` | −1 | The limit of depth for nested tags in the style of think tags. |
| Non-Speaker Role in Group | `db.groupOtherBotRole` | User | User, System, Assistant | The role that the app assigns to the turns of characters that do not speak in a group chat. If you set it to Assistant, Format Group in Single also applies to the speaker. |
| Custom Toggles | `db.customPromptTemplateToggle` | empty | Lines in the form `var=name`, one per line. They define custom prompt toggles that you can use as `getglobalvar::toggle_<var>` in CBS. |
| Default Variables | `db.templateDefaultVariables` | empty | Lines in the form `name=value` that define default template variables. If the own default variable of a character has the same name, it wins. |
| Predicted Output | `db.OAIPrediction` | empty | The app sends it as the "predicted output" content of OpenAI, when it is not empty. |
| Auto Suggest | `db.autoSuggestPrompt` | empty (the text in the box is only a placeholder. It is not a saved default.) | The prompt that the auto-suggest feature uses. |
| Non-Speaker Inner Format | `db.groupTemplate` | empty | Overrides the default wrapper for each character for non-speakers in a group chat. It falls back to a built-in template when it is empty. It also applies to the speaker if Non-Speaker Role in Group is set to Assistant. |
| System Content Replacement | `db.systemContentReplacement` | `system: {{slot}}` | The prompt format that replaces a system prompt if the model does not support one. The app replaces `{{slot}}` in it with the original content of the system prompt (only its first occurrence). It applies only to models without the "full system prompt" capability. On a model that supports only a first system prompt, the app keeps the leading run of system messages as it is. Every other system message gets this treatment. If the format has no `{{slot}}`, the app drops the original content. An empty field falls back to a plain prefix `system: <content>` instead. |
| System Role Replacement | `db.systemRoleReplacement` | User | The role that replaces `system` in that same replacement step. Options: User, Assistant. |
| JSON Schema | `db.jsonSchema` | empty | Schema text in the style of an interface. The app converts it into the schema object of the request. |
| Extract JSON | `db.extractJson` | empty | A dotted path (for example `response.text.0`). The app applies it to the raw response text to pull out the final answer, when JSON-schema mode is active. |
<!-- src/lib/Setting/Pages/PromptSettings.svelte:259-306,272,279-283,294-299; src/ts/storage/database.svelte.ts:444,569; src/ts/process/index.svelte.ts:438,492,526,788-791,864,898,937,1044-1053,1061,1281,1388-1391,1467,1622; src/ts/process/request/anthropic.ts:543,1200; src/ts/process/request/google.ts:525,618,1089; src/ts/process/request/openAI/requests.ts:405,689,701,852,1014,1111; src/ts/process/request/openAI/responses.ts:363,451,608; src/ts/process/request/request.ts:348-374,427-428; src/ts/process/templates/jsonSchema.ts:128-149; src/lang/en.ts:249 -->

### Auxiliary Model Selectors

The page shows them here when **Auxiliary Model Selectors under Model Settings** is off. When it is on, the page shows them on the Model tab (see above).

| Setting | Field | Default | What it does |
|---|---|---|---|
| Separate Models for Auxiliary Models | `db.seperateModelsForAxModels` | off | The master toggle. It uses a distinct model for each auxiliary purpose, instead of Auxiliary Model for all of them. |
| Do Not Change Separate Models on Preset Change | `db.doNotChangeSeperateModels` | off | When it is on, a switch of presets no longer overwrites your choices of separate models with those of the loaded preset. When you save the current preset, the app stores this state as "off" with the models cleared. |
| Memory / Translations / Emotion / OtherAx | `db.seperateModels.{memory,translate,emotion,otherAx}` | empty each | An override of the model for each purpose. The app uses it only when Separate Models for Auxiliary Models is on. |
<!-- src/lib/Setting/Pages/Model/AuxModelSelectors.svelte:9-28; src/ts/storage/database.svelte.ts:2117-2118,2241-2249 -->

### Fallback Model

| Setting | Field | Default | What it does |
|---|---|---|---|
| Fallback When Blank Response | `db.fallbackWhenBlankResponse` | off | Suppose a request "succeeds" but returns a blank response, and a list of fallback models has more entries left. Then the app advances to the next fallback model instead of accepting the blank reply. |
| Do Not Change Fallback Models on Preset Change | `db.doNotChangeFallbackModels` | off | Skips the overwrite of your lists of fallback models when you switch presets. |
| Fallback lists (Model / Memory / Translate / Emotion / OtherAx) | `db.fallbackModels.{model,memory,translate,emotion,otherAx}` | empty each | Ordered lists of models to try, for each type of call, with +/− buttons. |
<!-- src/lib/Setting/Pages/PromptSettings.svelte:312-352; src/ts/process/request/request.ts:207-224,309 -->

---

## Presets

Click **Presets** on the Others tab to open the modal for the management of presets.

| Action | What it does |
|---|---|
| Select a preset | Saves everything that is on this page now into the preset that you leave. Then loads the values of the preset that you clicked onto the page. |
| Rename (edit mode) | Type directly into the name field of the preset. |
| Reorder | Drag and drop a row to move it. The preset that is selected now stays selected even if its position changes. |
| Copy | Saves the current preset, then duplicates the preset that you clicked, with " Copy" appended to its name. It does not switch to the copy. |
| Export | Saves the current preset first. Then it offers a plain download (a compressed, encrypted `.risup` file) or an upload to Realm. If you choose RisuRealm, the app asks you to accept the terms of upstream RisuAI first, if you have not accepted them yet. If you decline, the app uploads nothing. **Exported presets never include your API keys or private URLs.** The app strips these before the export: OpenAI API Key, the Reverse Proxy URL and its secondary URL, Proxy Key, and the blocking and stream URLs of text-generation-webui. |
| Delete | Asks you to accept first. It is blocked if the preset is the only one. It switches to the first preset (it saves your current edits first, as any switch does), removes the chosen preset, then loads the values of the first preset again. |
| Add new preset | Adds a new preset, cloned from the preset "OAI2" that comes with the app, with the name "New Preset". It does not switch to it. |
| Import | Loads a preset from a file (plain JSON, or the encrypted `.risup` format) and adds it as a new preset. |
| Diff | The page shows it only when **Show Prompt Comparison** (Display & Audio settings) is on. Click two presets one after the other to open a comparison side by side. |
<!-- src/lib/Setting/botpreset.svelte:28-326,228-234,244-262,296-301; src/ts/storage/database.svelte.ts:2139-2157,2159-2277,2293-2398 -->

**Live edits and presets.** When you change any control on this page (temperature, model, and so on), the app saves it at once to the database of the whole app. The app copies it into the *saved entry of the preset* only when you switch presets, copy a preset, or export one. A switch of presets always saves first. So under normal use, you never lose your last edits. But suppose you close the app without a switch, a copy, or an export. Then the stored preset itself is one step behind your last live edits.
<!-- src/ts/storage/database.svelte.ts:2140,2150,2294; src/ts/storage/dbChangeEffects.svelte.ts -->

**Quick switch.** Ctrl+1 through Ctrl+9 switch to the 1st through 9th preset from anywhere in the app, not only on this settings page. Each press saves the current preset first, exactly like a click on a preset row. It shows a toast with the name of the preset that you switched to. It is suppressed while any modal is open. The text on the buttons and in the footer of the app does not state an upper limit. But the hotkey reaches only the first 9 presets. A 10th or later preset has no keyboard shortcut.
<!-- src/ts/hotkey.ts:188-244,418-427 -->
