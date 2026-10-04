# Settings: Language

Part of [[Settings]]. Open **Settings → Language**.

<!-- src/lib/Setting/Pages/LanguageSettings.svelte; src/ts/setting/languageSettingsData.svelte.ts -->

## UI Language

**UI Language** picks the language the app's own interface is shown in.

| Option | Language |
|---|---|
| Deutsch | German |
| English (default) | English |
| 한국어 | Korean |
| 中文 | Chinese |
| 中文(繁體) | Chinese Traditional |
| Tiếng Việt | Vietnamese |
| [Translate in your own language] | opens the flow below |

Picking **[Translate in your own language]** opens a second choice:

1. **Continue Translating Existing Language** — pick one of German, Korean, Chinese, Vietnamese or Chinese Traditional. The app downloads that language's current translation file as JSON, so you can fill in anything missing.
2. **Make a new language** — downloads the English source file as JSON, to use as a template for a language not listed above.

Either way, you get a message asking you to translate the downloaded JSON and send it to the developer (by Discord DM or email) for inclusion in a future version. **UI Language** is then reset to English, and a red "Close the settings to take effect" banner appears below the dropdown until you close and reopen Settings.

Note: the five-language list in step 1 does not include Spanish, even though Spanish ships as a language in the app.

<!-- src/ts/setting/languageSettingsData.svelte.ts:20-90; src/lang/en.ts:795-800 -->

---

## Translator

These settings configure automatic translation of chat messages.

| Setting | What it does | Default | Options |
|---|---|---|---|
| **Translator Language** | Target language for translation. Disabled turns off translation entirely and hides every other translator control on this page. | Disabled | Disabled, Korean, Russian, Chinese, Chinese (Traditional) *(Google only)*, Persian (Farsi) *(Google only)*, Japanese, French, Spanish, Portuguese, German, Indonesian, Malaysian, Ukrainian |
| **Translator Type** | Which translation engine to use. Shown once Translator Language is set. | Google | Google, DeepL, Ax. Model, DeepL X, Firefox |

Note: **Chinese (Traditional)** and **Persian (Farsi)** are only offered while Translator Type is Google. If Translator Language is set to one of them and you then switch Translator Type away from Google, Translator Language resets to the last option in the list (Ukrainian) rather than to Disabled.

<!-- src/ts/setting/languageSettingsData.svelte.ts:93-135; src/lib/Setting/Wrappers/SettingSelect.svelte:38-44 -->

### Google

No extra fields besides **Source Language** (see General options below).

### DeepL

On the web version (not the desktop app), a warning is shown that DeepL can cause CORS errors.

The **deepL API Key** and the **deepLX Token** (below) accept a ${NAME} environment-variable reference instead of a key. See [[API Keys from Environment Variables]].

| Label | What it does | Default |
|---|---|---|
| **deepL API Key** | Authenticates DeepL requests. | empty |
| **deepL Free API Key** | Switches between DeepL's free-tier and paid endpoint. | off |

<!-- src/ts/setting/languageSettingsData.svelte.ts:139-162; src/ts/translator/translator.ts:129-152 -->

### DeepL X

For a self-hosted DeepL X translation server.

| Label | What it does | Default |
|---|---|---|
| **deepLX URL** | Base URL of the server; normalized to end in `/translate`. | `http://localhost:1188` |
| **deepLX Token** | Auth token sent with requests. | empty |

<!-- src/ts/setting/languageSettingsData.svelte.ts:164-180; src/ts/translator/translator.ts:164-174 -->

### Ax. Model

Uses a preset prompt sent through your currently configured chat model, instead of a dedicated translation API. See Ax. Model presets below.

### Firefox

| Label | What it does | Default |
|---|---|---|
| **HTML Translate** | Uses Firefox's Bergamot engine's HTML-aware translation instead of plain text. | off |

<!-- src/ts/setting/languageSettingsData.svelte.ts:211-218 -->

### Source Language

Shown only when Translator Type is Google.

| Setting | What it does | Default | Options |
|---|---|---|---|
| **Source Language** | Language to translate from. | Auto | Auto, English, Chinese, Japanese, Korean, French, Spanish, German, Russian |

<!-- src/ts/setting/languageSettingsData.svelte.ts:189-209 -->

---

## General translation options

Shown once a Translator Language is set (not Disabled).

| Setting | What it does | Default | Shown when |
|---|---|---|---|
| **Auto Translation** | Translates every new reply automatically as it arrives. | off | translator on |
| **Combine Translation** | Joins one sentence that has been split across HTML tags before translating it, then re-applies Modify Display. | off | translator on |
| **Legacy Translation** | Uses the old translation method: Markdown and quotes are processed before the text is translated, instead of after. | off | translator on |
| **Translate Before HTML Formatting** | Runs HTML translation before the Modify-Display/regex formatting stage, and changes the cache-lookup key to the raw display text instead of the pre-formatted text. | off | Translator Type is Ax. Model |
| **Auto-translate Cached Messages Only** | Only serves already-cached translations during auto-translation, instead of requesting new ones. | off | Translator Type is Ax. Model |

<!-- src/ts/setting/languageSettingsData.svelte.ts:221-268; src/lib/ChatScreens/ChatBody.svelte:83-88,120-123,84; src/lib/ChatScreens/Chat.svelte:416-424; src/ts/translator/translator.ts:447-478; src/lang/en.ts:202-203 -->

---

## Translation cache (Ax. Model only)

| Button | What it does |
|---|---|
| **Export Translation Cache** | Downloads the Ax. Model translation cache as `translation_cache.json`. If the cache is empty, shows a message instead of downloading. |
| **Import Translation Cache** | Loads a `.json` file (must be a flat object of string keys to string values, or it's rejected), asks for confirmation, then merges it into the cache and reports how many entries were imported and how many failed. |
| **Clear Translation Cache** | Asks for confirmation, then empties the cache. |

<!-- src/ts/setting/languageSettingsData.svelte.ts:271-367 -->

### Ax. Model presets

Shown when Translator Type is Ax. Model. A separate preset list from the model/preset system used for chat generation, so you can keep a translation-specific prompt without touching your chat presets.

| Control | Does |
|---|---|
| Preset dropdown | Switches which preset is being edited/used. |
| + (add) | Creates a new preset and selects it. |
| Pencil (rename) | Renames the current preset. |
| Trash (delete) | Deletes the current preset. Blocked if it is the only one left. |
| Download (export) | Downloads the preset as a file. |
| Upload (import) | Loads a preset from an exported file and adds it as a new preset. |

Each preset has:

| Label | Field | Default | Range | What it does |
|---|---|---|---|---|
| **Translation Response Size** | `maxResponse` | 1000 | 0–2048 | Token budget for the translation response. |
| **Translation Prompt** | `prompt` | empty (placeholder shows the built-in default) | free text | Prompt used to ask the chat model to translate. |

Translating with Ax. Model reuses whichever chat model/provider is currently configured for ordinary chat generation — there is no separate translator-model picker. Results are cached, keyed by source text.

<!-- src/lib/Setting/Pages/Language/TranslatorPresetSettings.svelte; src/ts/translator/presets.ts:71-73,90-101; src/ts/translator/translator.ts:515-585 -->
