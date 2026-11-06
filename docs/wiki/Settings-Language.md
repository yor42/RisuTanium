# Settings: Language

This page belongs to [[Settings]]. To open it, go to **Settings → Language**.

<!-- src/lib/Setting/Pages/LanguageSettings.svelte; src/ts/setting/languageSettingsData.svelte.ts -->

## UI Language

**UI Language** picks the language of the interface of the app.

| Option | Language |
|---|---|
| Deutsch | German |
| English (default) | English |
| 한국어 | Korean |
| 中文 | Chinese |
| 中文(繁體) | Chinese Traditional |
| Tiếng Việt | Vietnamese |
| [Translate in your own language] | Opens the flow below. |

If you pick **[Translate in your own language]**, a second choice opens:

1. **Continue Translating Existing Language**: Pick one of German, Korean, Chinese, Vietnamese, or Chinese Traditional. The app downloads the current translation file of that language as JSON. You can then fill in anything that is missing.
2. **Make a new language**: The app downloads the English source file as JSON. Use it as a template for a language that the list does not show.

In both cases, the app shows a message. The message asks you to translate the downloaded JSON and send it to the developer, by Discord DM or email. The developer can then include it in a future version. The app resets **UI Language** to English. A red "Close the settings to take effect" banner appears below the dropdown. It stays until you close and reopen Settings.

Note: The list of five languages in step 1 does not include Spanish. Spanish is still a language of the app.

<!-- src/ts/setting/languageSettingsData.svelte.ts:20-90; src/lang/en.ts:795-800 -->

---

## Translator

These settings configure the automatic translation of chat messages.

| Setting | What it does | Default | Options |
|---|---|---|---|
| **Translator Language** | The target language of the translation. The value Disabled turns off translation completely and hides every other translator control on this page. | Disabled | Disabled, Korean, Russian, Chinese, Chinese (Traditional) *(Google only)*, Persian (Farsi) *(Google only)*, Japanese, French, Spanish, Portuguese, German, Indonesian, Malaysian, Ukrainian |
| **Translator Type** | The translation engine to use. The page shows it after you set Translator Language. | Google | Google, DeepL, Ax. Model, DeepL X, Firefox |

Note: The page offers **Chinese (Traditional)** and **Persian (Farsi)** only while Translator Type is Google. Suppose Translator Language is one of them, and you then switch Translator Type away from Google. Then Translator Language resets to the last option in the list (Ukrainian). It does not reset to Disabled.

<!-- src/ts/setting/languageSettingsData.svelte.ts:93-135; src/lib/Setting/Wrappers/SettingSelect.svelte:38-44 -->

### Google

Google has no extra fields besides **Source Language**. See General options below.

### DeepL

On the web version (not the desktop app), the page shows a warning that DeepL can cause CORS errors.

The **deepL API Key** and the **deepLX Token** (below) accept a ${NAME} environment-variable reference instead of a key. See [[API Keys from Environment Variables]].

| Label | What it does | Default |
|---|---|---|
| **deepL API Key** | Authenticates DeepL requests. | empty |
| **deepL Free API Key** | Switches between the free-tier endpoint and the paid endpoint of DeepL. | off |

<!-- src/ts/setting/languageSettingsData.svelte.ts:139-162; src/ts/translator/translator.ts:129-152 -->

### DeepL X

This type is for a DeepL X translation server that you host yourself.

| Label | What it does | Default |
|---|---|---|
| **deepLX URL** | The base URL of the server. The app normalizes it so that it ends in `/translate`. | `http://localhost:1188` |
| **deepLX Token** | The auth token that the app sends with requests. | empty |

<!-- src/ts/setting/languageSettingsData.svelte.ts:164-180; src/ts/translator/translator.ts:164-174 -->

### Ax. Model

This type uses a preset prompt. The app sends the prompt through the chat model that you configured now. It does not use a dedicated translation API. See Ax. Model presets below.

### Firefox

| Label | What it does | Default |
|---|---|---|
| **HTML Translate** | Uses the HTML-aware translation of the Bergamot engine of Firefox instead of plain-text translation. | off |

<!-- src/ts/setting/languageSettingsData.svelte.ts:211-218 -->

### Source Language

The page shows this setting only when Translator Type is Google.

| Setting | What it does | Default | Options |
|---|---|---|---|
| **Source Language** | The language to translate from. | Auto | Auto, English, Chinese, Japanese, Korean, French, Spanish, German, Russian |

<!-- src/ts/setting/languageSettingsData.svelte.ts:189-209 -->

---

## General translation options

The page shows these options after you set a Translator Language (not Disabled).

| Setting | What it does | Default | Shown when |
|---|---|---|---|
| **Auto Translation** | Translates every new reply automatically when it arrives. | off | The translator is on. |
| **Combine Translation** | Joins a sentence that HTML tags split into one sentence before translation. Then it applies Modify Display again. | off | The translator is on. |
| **Legacy Translation** | Uses the old translation method. The app processes Markdown and quotes before it translates the text, not after. | off | The translator is on. |
| **Translate Before HTML Formatting** | Runs the HTML translation before the Modify-Display and regex formatting stage. It also changes the cache-lookup key to the raw display text instead of the pre-formatted text. | off | Translator Type is Ax. Model. |
| **Auto-translate Cached Messages Only** | During auto-translation, serves only translations that are already in the cache. It requests no new translations. | off | Translator Type is Ax. Model. |

<!-- src/ts/setting/languageSettingsData.svelte.ts:221-268; src/lib/ChatScreens/ChatBody.svelte:83-88,120-123,84; src/lib/ChatScreens/Chat.svelte:416-424; src/ts/translator/translator.ts:447-478; src/lang/en.ts:202-203 -->

---

## Translation cache (Ax. Model only)

| Button | What it does |
|---|---|
| **Export Translation Cache** | Downloads the Ax. Model translation cache as `translation_cache.json`. If the cache is empty, the app shows a message instead of a download. |
| **Import Translation Cache** | Loads a `.json` file. The file must be a flat object that maps string keys to string values. Otherwise the app rejects it. The app asks you to accept, merges the file into the cache, and reports how many entries it imported and how many failed. |
| **Clear Translation Cache** | Asks you to accept, then empties the cache. |

<!-- src/ts/setting/languageSettingsData.svelte.ts:271-367 -->

### Ax. Model presets

The page shows these controls when Translator Type is Ax. Model. The list of presets is separate from the model and preset system that the app uses for chat generation. You can keep a translation-specific prompt without a change to your chat presets.

| Control | What it does |
|---|---|
| Preset dropdown | Switches the preset that you edit and use. |
| + (add) | Creates a new preset and selects it. |
| Pencil (rename) | Renames the current preset. |
| Trash (delete) | Deletes the current preset. The app blocks this if the preset is the only one left. |
| Download (export) | Downloads the preset as a file. |
| Upload (import) | Loads a preset from an exported file and adds it as a new preset. |

Each preset has these fields:

| Label | Field | Default | Range | What it does |
|---|---|---|---|---|
| **Translation Response Size** | `maxResponse` | 1000 | 0–2048 | The token budget for the translation response. |
| **Translation Prompt** | `prompt` | empty (the placeholder shows the built-in default) | free text | The prompt that asks the chat model to translate. |

Translation with Ax. Model reuses the chat model and provider that you configured now for ordinary chat generation. There is no separate picker for a translator model. The app caches the results. The key of each cache entry is the source text.

<!-- src/lib/Setting/Pages/Language/TranslatorPresetSettings.svelte; src/ts/translator/presets.ts:71-73,90-101; src/ts/translator/translator.ts:515-585 -->
