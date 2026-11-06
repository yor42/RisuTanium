# Settings: Advanced

This page belongs to [[Settings]]. To open it, go to **Settings → Advanced Settings**. The page shows a warning banner ("Warn: If you don't know what the option does, don't change it!") and then a flat list of controls. It has no tabs.
<!-- src/ts/setting/advancedSettingsData.ts:6-7 -->

The page is built from one data table (`advancedSettingsItems`). It is not written by hand for each field.
<!-- src/ts/setting/advancedSettingsData.ts:5-259 -->

These points apply across the whole page:

- **Help (?) icons** open a text popup with more detail. Not every setting has one.
- Some fields have no help-key entry in the English strings. They fall back to their own hard-coded label. Those labels are **not translated**. They appear in English even when the language of the app is set to something else. The tables below mark them.
- A flask icon marks a setting as experimental. The icon itself does not hide anything. The checkboxes **Use Experimental** and **Show Unrecommended**, described below, control separately whether the page shows a setting. A few settings with a flask are always visible, whatever the **Use Experimental** checkbox says: **OpenAI Flex Processing**, **Claude Batching**, and **Persona Note**. For these, only the icon appears.
- The tables below group settings by what they affect. On the actual page, the settings appear in one continuous list, in the order that the underlying data table defines. They do not appear in these groups.

---

## Prompting, lorebook, and chat flow

| Setting | Field | What it does | Default | Range/options | Shown when |
|---|---|---|---|---|---|
| **Lorebook Search Depth** | `loreBookDepth` | The number of recent messages that the app scans for lorebook key matches, unless a character overrides it with its own scan depth. | 5 | 0–20 | always |
| **Lorebook Max Tokens** | `loreBookToken` | The token budget for lorebook entries for each generation, unless a character overrides it. | 800 | 0–4096 | always |
| **Target Tokens (Auto Continue)** | `autoContinueMinTokens` | If you set it above 0, and a response comes back shorter than this many tokens, the app continues the generation automatically. | 0 | min 0 | always |
| **Additional Prompt** | `additionalPrompt` | Text that the app appends to the Main Prompt. It applies only when **Use Prompt Preprocess** of the preset is on. See [[Settings Chat Bot]]. | "The assistant must act as {{char}}. user is {{user}}." | free text | always |
| **Description Prefix** | `descriptionPrefix` | A prefix for the character description. It applies only when **Use Prompt Preprocess** of the preset is on. See [[Settings Chat Bot]]. | "description of {{char}}: " | free text | always |
| **Emotion Prompt** | `emotionPrompt2` | The prompt that detects which emotion image to show. If you leave it blank, the app uses the built-in default prompt. | "" (blank) | free text | always |
| **Preset Chain** | `presetChain` | If it is not blank, it is a list of preset names, separated by commas. Each time you send a message, the app picks one of them at random and applies it before the request. | not set (off) | free text, placeholder "Leave it blank to not use" | always |
| **Input 'say nothing' when no string inputed** | `useSayNothing` | If it is on, a send with an empty message box inserts a "*says nothing*" turn instead of sending nothing. | true | none | always |
| **Anti-Incomplete Response (Auto Continue)** | `autoContinueChat` | Tries to continue the chat automatically if the response does not end with punctuation. The label warns: Do not use this with languages that do not use punctuation. | false | none | always |
| **Remove Incomplete Sentences** | `removeIncompleteResponse` | Strips a response that an aborted or failed generation left incomplete. | not set (off) | none | always |
| **Memory Punctuation Removal** | `removePunctuationHypa` | Strips punctuation from the text of the SupaMemory summary before the app stores it. | true | none | always |
| **Remember tool usage** | `rememberToolUsage` | The app passes it through to the options of the main generation pipeline. It affects the handling of tool calls during a chat turn. | true | none | always |
| **Persona Note** | `personaNote` | Shows or hides the **Note** field on [[Settings Persona]]. | not set (off) | none | always (flask icon, not controlled by **Use Experimental**) |
| **Disable Separate Parameter Change on Preset Change** | `disableSeperateParameterChangeOnPresetChange` | When it is on, a switch of presets no longer overwrites the "separate parameters" of each model. It is also one of the checks that Easy Panel uses before it shows its tabs for models and parameters. | not set (off) | none | always |

<!-- src/ts/setting/advancedSettingsData.ts:11-22,26-43,121,143-144,186,212,211,167; src/lang/en.ts:143,151-282,776-1697 -->

---

## Requests and network

| Setting | Field | What it does | Default | Range/options | Shown when |
|---|---|---|---|---|---|
| **Request Retrys when Fail** | `requestRetrys` | The number of times that the app retries a failed request. | 2 | 0–20 | always |
| **Generation Choices** | `genTime` | The number of responses to generate on models that support it. The app treats every response after the first as a cached reroll. This can lower the cost. But it can also raise the cost if you use it without rerolling. | 1 | 0–4096 | always |
| **Vision Quality** | `gptVisionQuality` | The quality of the model that detects images. Higher quality is more accurate, but it uses more tokens. | Low | Low, High | always |
| **Request Location** | `requestLocation` | Adds a `risu-location` header to outgoing proxied requests: Default (no header), EU (GDPR), or US (FedRAMP). | Default | Default, EU (GDPR), US (FedRAMP) | web build only (not shown on Node-server or Tauri builds) |
| **Autofill Request URL** | `autofillRequestUrl` | Fills in the request URL automatically to match the current model, when the model is set to reverse proxy. | true | none | always |
| **Local Network Mode (Experimental)** (not translated, fallback label) | `localNetworkMode` | Routes private or LAN model URLs through the local runtime path instead of the direct fetch of the browser. This avoids the private-network and CORS restrictions of the browser. It controls the timeout field below. | false | none | always |
| **Local Network Timeout (sec)** (not translated, fallback label) | `localNetworkTimeoutSec` | The timeout that applies to local-network requests. | 600 | 30–3600 | only when **Local Network Mode** is on |
| **New OpenAI Handling** | `newOAIHandle` | Changes how the app formats messages with the name `example_` and messages with the `NewChat` memo for requests in the OpenAI format. | true | none | always |
| **Dynamic Model Registry** | `dynamicModelRegistry` | Lets the list of models refresh and extend itself dynamically, instead of staying static. | true | none | always |
| **Anti-Server Overload** | `antiServerOverloads` | If an Anthropic "overload" error happens in the middle of a stream, the app retries with the same prompt. This makes it less likely that the error recurs. The app also checks this setting in the Gemini fallback path. | not set (off) | none | always |
| **OpenAI Flex Processing** | `openAIFlexProcessing` | Uses the Flex service tier of OpenAI. Responses can be slower, but they cost less (batch-API pricing). It applies only to official OpenAI Chat Completions requests. | false | none | always (flask icon, not controlled by **Use Experimental**) |
| **Claude 1 Hour Caching** | `claude1HourCaching` | Sets the extended-TTL cache control on the last cached content block in Anthropic requests. It also sends the corresponding beta header. | not set (off) | none | always |
| **Claude Batching** | `claudeBatching` | Removes the `stream` field from outgoing Anthropic requests (except Ollama-Cloud-Anthropic). This switches to the shape of the non-streaming batch API. | not set (off) | none | always (flask icon, not controlled by **Use Experimental**) |
| **Simplified tool usage** | `simplifiedToolUse` | Changes how the request builders for OpenAI and Google build tool calls. In the Google format specifically, it controls whether the app keeps the text response next to a tool call. | false | none | always |
| **Force Proxy Format as OpenAI** | `forceProxyAsOpenAI` | The label says that it forces the request format of OpenAI when you use a reverse proxy. It has no effect now. Nothing in the codebase reads this field except its own type declaration, the definition of this setting, and the language strings. | not set (off) | none | always |

<!-- src/ts/setting/advancedSettingsData.ts:46-56,60-68,109-118,127-142,162,166-168,172-177,204-217; src/lang/en.ts:171-175,206-207,862,1061,1111,1494,1499-1502,1560-1568,1687 -->

---

## Display, performance, and assets

| Setting | Field | What it does | Default | Range/options | Shown when |
|---|---|---|---|---|---|
| **Asset Max Difference** | `assetMaxDifference` | The threshold for the fuzzy matcher of names of dynamic assets. If the distance of the closest match is above this value, the app discards the match. | 4 | no min/max set | always |
| **Keep Session Alive** | `keepSessionAlive` | Keeps the browser tab active, so that the session does not expire from inactivity. You can need a refresh for it to take effect. Off, or Via Sound (plays near-silent audio periodically. This is the method that works in the most browsers). | Off | Off, Via Sound | always |
| **Height Mode** | `heightMode` | Sets which CSS height unit the layout of the app uses (`--risu-height-size`): Normal, Percent, VH, DVH, SVH, or LVH. | Normal | Normal, Percent, VH, DVH, SVH, LVH | always |
| **Initial Chat Load Count** | `chatLoadInitialPages` | The number of recent chat messages that the app renders when a chat screen opens. A higher value shows more history at once. But it can make the opening of a long chat heavier. | 30 | min 1 | always |
| **Additional Chat Load Count** | `chatLoadAdditionalPages` | The number of older messages that the app renders each time you scroll to the top. A higher value reduces repeated loading, but it makes each load heavier. | 15 | min 1 | always |
| **Image Compression** | `imageCompression` | Compresses images when you export a character. If an animated image stops working after the export, try to turn this off. | true | none | always |
| **Legacy Media Findings** | `legacyMediaFindings` | Uses the old method to find media assets, without the newer search algorithm. | not set (off, uses the new method) | none | always |
| **New Image Handling (Beta)** | `newImageHandlingBeta` | Switches the rendering of chat images to a newer path that constructs the image body. | not set (off) | none | always |
| **Allow all in file select** (not translated, fallback label) | `allowAllExtentionFiles` | Widens the native file picker, so it no longer restricts by extension. | not set (off) | none | always |
| **No Wait for Translate** | `noWaitForTranslate` | When it is on, the display of the message does not wait for the auto-translate step to finish. | not set (off) | none | always |
| **Enable Scroll to Active Character** | `enableScrollToActiveChar` | The hotkey, or Ctrl held while you drag a character, scrolls the sidebar to the active character. The sidebar opens closed folders automatically. | true | none | always |
| **Return CSS Error** | `returnCSSError` | If the custom CSS of a character fails to apply, the app shows a "CSS ERROR: ..." message instead of failing silently. | true | none | always |
| **Directly open character in RisuRealm** | `realmDirectOpen` | A click on the preview of a character in the RisuRealm browser opens the character directly, instead of only opening the Realm view. | false | none | always |
| **Bookmark** | `enableBookmark` | Shows or hides the bookmark button in the row of icons of a message. | not set (off) | none | always |
| **Tokenizer Caching** | `useTokenizerCaching` | Caches tokenizer results in memory, keyed by a hash of the input. The app then does not tokenize the same text again and again. | not set (off) | none | always |
| **Show Separate Aux Models in Model Settings** | `auxModelUnderModelSettings` | Shows a selector block for the auxiliary model inside Bot Settings. | not set (off) | none | always |
| **Dynamic Assets** | `dynamicAssets` | If the app does not find an asset name while it processes data, it looks up the closest asset name by vector search and uses that name instead. It controls the setting below. | not set (off) | none | always |
| **Use Dynamic Assets in Display** | `dynamicAssetsEditDisplay` | Applies the lookup of dynamic assets to the "Modify Display" script stage too. The help text warns that this can cause performance issues. | not set (off) | none | only when **Dynamic Assets** is on |

<!-- src/ts/setting/advancedSettingsData.ts:55,72-79,84-95,99-105,123,126,163-165,188,204-206,213-216; src/lang/en.ts:151,175-177,222,258,274,974,1183,1185,1220-1221,1314,1392,1488,1550,1575,1626 -->

---

## Saving and backup

Fork difference: Upstream has three more rows in this group: **Kei Server URL**, **Lightning Realm Import**, and **Skip Saving Assets on Web Sync**. They were controls for account sync only. The fork removed them together with account sync. These rows remain:

| Setting | Field | What it does | Default | Range/options | Shown when |
|---|---|---|---|---|---|
| **Cold Storage** | `coldstorage` | Turns the automatic cold-storage feature for characters on or off. When it is off, the app does not move the chat data of inactive characters to cold storage. | On if no plugins were installed when a build with this setting first loaded the save. Otherwise off. | none | always |
| **Enable Remote Saving** | `enableRemoteSaving` | Controls whether the app writes "remote" character blocks through the remote-save path. Only the Tauri desktop build bypasses it. That build writes the primary database directly. | not set (off) | none | always |

<!-- src/ts/setting/advancedSettingsData.ts:200-201; src/lang/en.ts:1685 -->

---

## Experimental (shown with **Use Experimental**)

**Enable Experimental Features** (`useExperimental`, unchecked by default) reveals the five settings below. If you turn it off, they are hidden again. The app does not delete their stored values.

| Setting | Field | What it does | Default | Range/options | Shown when |
|---|---|---|---|---|---|
| **Streaming Display Optimization** | `streamingDisplayOptimizationMode` | Reduces display lag when long responses stream in with heavy post-processing, for example regex scripts. This can help on mobile or low-end devices. **Off** runs post-processing on every token (this can add real overhead). **Balanced** runs it only at intervals of about 0.125 seconds. **Strong** skips post-processing during the stream and runs it one time after the stream finishes. The help text calls this experimental and warns that some features can behave unexpectedly. | Off | Off, Balanced, Strong | **Use Experimental** on |
| **Google Cloud Tokenization** | `googleClaudeTokenizing` | Uses the own tokenizer of Google Cloud, instead of the generic one, for models whose tokenizer is the one of Google Cloud. The cache key of the tokenizer includes it. | not set (off) | none | **Use Experimental** on |
| **Automatic Cache Point** | `automaticCachePoint` | Creates an Anthropic prompt-cache breakpoint automatically after the chat ends, if one does not exist yet. | not set (off) | none | **Use Experimental** on |
| **New Google Translate Experimental** (not translated, fallback label) | `useExperimentalGoogleTranslator` | Switches to an alternate Google Translate code path of higher quality in the translator. Its help text points to the generic text "this is an unrecommended setting". | false | none | **Use Experimental** on |
| **Claude Caching Retrival** | `claudeRetrivalCaching` | Registers a response observer against the replacer or proxy URL for the retrieval of Claude caching. Its help text also points to the generic text "unrecommended setting". | not set (off) | none | **Use Experimental** on |

<!-- src/ts/setting/advancedSettingsData.ts:124,145-161,172-177,220-227; src/lang/en.ts:145-150,152,223,261,900,1373,1499-1500 -->

---

## Unrecommended (shown with **Show Unrecommended**)

**Show Unrecommended Settings** (`showUnrecommended`, unchecked by default) reveals the three settings below. Its own help text says: "it will show unrecommended, deprecated settings. It is NOT RECOMMENDED to use these settings."

| Setting | Field | What it does | Default | Range/options | Shown when |
|---|---|---|---|---|---|
| **Chain of Thoughts** | `chainOfThought` | Adds a chain-of-thought prompt to the prompt. Its help text (shown through the help icon in the deprecation style) says that the toggle is no longer recommended. It says to put chain-of-thought prompting in other prompt entries instead. | not set (off) | none | **Show Unrecommended** on |
| **Force Plain Fetch** | `usePlainFetch` | Forces the plain `fetch` API of the browser instead of the proxy or HTTP path of the platform. The help text warns that this can cause CORS errors. | not set (off) | none | **Show Unrecommended** on |
| **Show Deprecated Trigger V1** | `showDeprecatedTriggerV1` | Shows the button for the editing of legacy V1 triggers even when no V1 triggers exist. | not set (off) | none | **Show Unrecommended** on |

<!-- src/ts/setting/advancedSettingsData.ts:122,181-183; src/lang/en.ts:144,154,170,193 -->

---

## Plugins and developer tools

| Setting | Field | What it does | Default | Range/options | Shown when |
|---|---|---|---|---|---|
| **Enable Dev Tools** | `enableDevTools` | Shows a second "dev tool" tab button in the header of the character sidebar. | not set (off) | none | always |
| **Plugin Develop Mode** | `pluginDevelopMode` | The label says that it is a toggle for a plugin-developer mode. It has no effect now. Nothing in the codebase reads this field except its own type declaration, the definition of this setting, and the language strings. | not set (off) | none | always |
| **Add Prompt Info to Chat** | `promptInfoInsideChat` | Stores the name of the prompt preset, the active toggles, and the prompt text in chat metadata. The help text notes that this can slightly increase processing time and storage use. It controls the setting below. | false | none | Node-server or Tauri builds only |
| **Add Prompt Text to Chat** | `promptTextInfoInsideChat` | Adds the full prompt text (not only metadata) next to the field above. | not set (off) | none | Node-server or Tauri builds only, and only when **Add Prompt Info to Chat** is on |

<!-- src/ts/setting/advancedSettingsData.ts:187,192-198,217; src/lang/en.ts:264-265,1304,1554-1555,1644 -->

---

## Custom panels

These three entries are not simple fields. Each renders its own component.

### Auto Regenerate On Characterset

This is an accordion of 18 buttons for Unicode scripts: Latin, Han, Arabic, Devanagari, Cyrillic, Bengali, Hiragana, Katakana, Telugu, Hangul, Tamil, Thai, Gujarati, Kannada, Ethiopic, Khmer, Greek, and Hebrew. Each button shows a short preview of that script. A click on a script toggles its membership in the stored ban list (`banCharacterset`, which starts empty). After a generation finishes, the app checks the response against the character range of every listed script. If characters of a banned script are present, the app flags the response as failed.
<!-- src/lib/Setting/Pages/Advanced/BanCharacterSetSettings.svelte:1-32; src/lang/en.ts:1391 -->

### Custom Models

This is a full editor for your list of custom model definitions (`customModels`). You open an entry with a click on its row. Each entry has these fields:

| Field | What it is |
|---|---|
| Name | The display name of the model entry. |
| Request Model | The model id that the app sends in the proxy request (`internalId`). |
| URL | The endpoint URL. |
| Tokenizer | One of 16 options: Unknown, tiktokenCl100kBase, tiktokenO200Base, Mistral, Llama, NovelAI, Claude, NovelList, Llama3, Gemma, GoogleCloud, Cohere, DeepSeek, DeepSeek V4, GLM4, GLM5. |
| Format | One of 15 options: OpenAICompatible, OpenAILegacyInstruct, Anthropic, AnthropicLegacy, Mistral, GoogleCloud, VertexAIGemini, NovelList, Cohere, NovelAI, OobaLegacy, Ooba, Kobold, AWSBedrockClaude, OpenAIResponseAPI. |
| Key/Password | The API key that the app sends with requests to this model. |
| Additional Params | Freeform pairs `key=value`, one pair per line. The app adds them to the request body. Prefix a key with `header::` to send it as an HTTP header instead (for example `header::Authorization`). Prefix a value with `json::` to send it as parsed JSON. Use `{{none}}` as a value to exclude that key from the request entirely. |
| Flags | 24 boolean capability flags (for example `hasImageInput`, `hasStreaming`, `hasPrefill`, `claudeThinking`). They describe what the model supports. |

You can reorder entries with the up and down arrows and remove them with the trash icon. The app resolves a model whose id has the prefix `xcustom:::` against this list to build its runtime model info.
<!-- src/lib/Setting/Pages/Advanced/CustomModelsSettings.svelte:1-201; src/ts/model/modellist.ts:832-836; src/lang/en.ts:985-986,1208,1261,1269,1548 -->

### Show Log / Show Statistics / Export Settings for Bug Report

These are three buttons. None of them changes a stored setting:

- **Show Request Logs** opens the current request log of the app as a text popup.
- **Show Statistics** renders the internal usage counters of the app (`db.statics`) as a Markdown table.
- **Export Settings for Bug Report** downloads a JSON snapshot of your settings and also copies it to the clipboard. Before it exports, it removes these fields: `characters`, `loreBook`, `plugins`, `personas`, `username`, `userIcon`, `userNote`, `modules`, `enabledModules`, `botPresets`, `characterOrder`, `webUiUrl`, `hordeConfig`, `novelai`, `koboldURL`, `ooba`, `ainconfig`, `personaPrompt`, `promptTemplate`, `deeplOptions`, `google`, `customPromptTemplateToggle`, `globalChatVariables`, `comfyConfig`, `comfyUiUrl`, `translatorPrompt`, `translatorPresets`, `translatorPresetId`, `customModels`, `mcpURLs`, `authRefreshes`. It also removes every field whose name contains "key", "proxy", or "hypa" (case-insensitive). Then it adds a small `meta` block. The block records whether the build is Tauri, Node-server, and the protocol of the page.

<!-- src/lib/Setting/Pages/Advanced/SettingsExportButtons.svelte:1-76; src/lang/en.ts:864,1376,1576 -->
