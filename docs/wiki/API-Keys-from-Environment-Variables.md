# API Keys from Environment Variables

> **Fork-specific.** This feature exists in this fork only. Upstream RisuAI does not have it. See [Moving to or from upstream RisuAI](#moving-to-or-from-upstream-risuai).

You can type a reference such as `${RISU_OPENAI_KEY}` instead of an API key in a settings field. When RisuAI needs the key, it reads the environment variable with that name. It reads the variable on the machine that runs the Node server or the desktop app.

Reasons to use it:

- The app does not write the key to your database, backups, presets, or exports. It stores only the text of the reference.
- You can rotate a key if you change the variable. You do not have to edit RisuAI.
- You can share a backup or a preset, and the key does not go with it.

## What it does not do

Read this before you rely on the feature.

- **It does not keep the key away from the browser.** The server or desktop app sends the value to the page. The page reuses it for 5 minutes before it asks again. But it keeps a copy in memory until you reload the page. That copy lets the request log show the reference instead of the value.
- **On a shared Node server, anyone who can log in to the server can make it hand over any allowed variable.** This includes a login with the password, and a login that the server already trusts. "Allowed" means a name that fits the [name rule](#which-variables-can-be-read).
- It does not work in every build. See the next section.

## Where it works

| Build | Works? |
|---|---|
| Desktop app | Yes |
| Node server | Yes |
| Pure web build (no Node server) | No |
| Hono server | No |

Where it does not work, the app does not replace a reference. A request that needs it fails with an [error message](#error-messages).

## Syntax

The whole field must be one reference: `${NAME}`.

- `NAME` uses uppercase letters, digits, and underscores only. It must start with a letter or an underscore.
- The app ignores spaces around the reference.
- Partial text is **not** a reference. The app uses `Bearer ${RISU_X_KEY}` and `sk-${RISU_X_KEY}` exactly as you typed them, as if you typed a key. It also uses lowercase names such as `${risu_x_key}` as you typed them.

Example, in the **OpenAI API Key** field of [[Settings Chat Bot]]:

```
${RISU_OPENAI_KEY}
```

## Which variables can be read

The app can read a variable only if its name passes one of these two rules. The server or the desktop app does the check. The page does not do it.

1. **The `RISU_` rule.** The name is `RISU_`, then a name of your choice, then `_KEY` or `_TOKEN`.
   - The app reads: `RISU_OPENAI_KEY`, `RISU_X_TOKEN`.
   - The app does not read: `RISU_KEY` (nothing between `RISU_` and `_KEY`) and `RISU_OPENAI` (no suffix).
2. **The allow list.** Any other name works if it is listed exactly in a variable called `RISU_ALLOWED_ENV`, separated by commas. Example: `RISU_ALLOWED_ENV=FOO_API,BAR_API`.
   - The app ignores spaces around each entry, and it skips empty entries.
   - The match is exact and case-sensitive.
   - The names listed there must still be uppercase letters, digits, and underscores.
   - You must set RISU_ALLOWED_ENV itself on the machine that runs the server or the desktop app. The server and the desktop app read it on each lookup, together with the variable that you ask for. They do not read it at startup.

A name that fails both rules is treated like a variable that is not set. You see the same message in both cases. This is deliberate, so nobody can use it to find out which variables exist.

## Setting the variable

Set it on the machine that runs the server or the desktop app.

- **Node server:** Set it in the shell that starts the server, or in the environment of the service or container that runs it.
- **Desktop app:** Set it in the operating system environment of your user. An app that you start from a menu, dock, or shortcut can fail to see a variable that you only exported in a terminal.

**Restart after you set or change it.** A program gets its environment when it starts. A server or app that already runs does not see a variable that you set or change afterward. Restart the Node server, or fully quit and reopen the desktop app. After a server restart, an open page can still use the old value for a few minutes. See [How long a change takes](#how-long-a-change-takes).

The server does not read a `.env` file. Set a real environment variable.

The examples use `RISU_OPENAI_KEY` and the placeholder value `sk-...`.

### Windows

- **Settings:** Search for "Edit environment variables for your account". Choose **New** under User variables, and enter the name and value.
- **Terminal:** `setx RISU_OPENAI_KEY "sk-..."`. This affects programs that you start afterward. It does not affect the terminal in which you typed it.
- **One run of the Node server (PowerShell):** `$env:RISU_OPENAI_KEY = "sk-..."`, then start the server in that same window.
- If the desktop app still does not see the variable, sign out and back in.

### macOS

- **Node server:** Run `export RISU_OPENAI_KEY="sk-..."` in the terminal, then start the server from it. Add the line to `~/.zshrc` to keep it for new terminals.
- **Desktop app:** The RisuAI app that you open from Finder or the Dock does not read `~/.zshrc`. Run `launchctl setenv RISU_OPENAI_KEY "sk-..."`, then reopen the app. This lasts until you restart or log out. Or start the executable of the app from a terminal where you exported the variable.

### Linux

- **Shell:** Run `export RISU_OPENAI_KEY="sk-..."`, or add the line to `~/.profile`. For an app that you start from the desktop, you can need to log out and back in.
- **Desktop session:** Put `RISU_OPENAI_KEY=sk-...` in a file such as `~/.config/environment.d/risu.conf`, then log out and back in.
- **Node server as a systemd service:** Add `Environment=RISU_OPENAI_KEY=sk-...` (or `EnvironmentFile=`) to the unit. Then run `systemctl daemon-reload` and restart the service.

### Docker

Add an `environment:` entry to the `risutanium` service in `docker-compose.yml`:

```yaml
services:
  risutanium:
    environment:
      RISU_OPENAI_KEY: ${RISU_OPENAI_KEY}
```

Docker Compose fills in `${RISU_OPENAI_KEY}` from your shell, or from a `.env` file next to `docker-compose.yml`. Compose reads that `.env`, not RisuAI. You can also write the value directly instead of `${...}`. Then run `docker compose up -d` to recreate the container. With `docker run`, pass `-e RISU_OPENAI_KEY=sk-...`.

Every program that the user runs can read a variable that you set at user level. That is the normal trade-off.

## Rules for the value

- The app trims spaces at both ends.
- The app rejects an empty value.
- The app rejects a value with a line break.

### Vertex AI private key

A Vertex AI private key (PEM) normally has several lines. So it needs special care:

- Write it on **one line**. Write a literal `\n` where each line break belongs.
- It must contain the lines `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----`. The app rejects a key that is marked `BEGIN RSA PRIVATE KEY`.
- You must fill in the **Vertex Client Email**, and it must contain `gserviceaccount.com`.

## How long a change takes

- RisuAI remembers a resolved value for **5 minutes** for each variable. A changed variable can take up to 5 minutes to apply. The app does not remember a failed lookup.
- For Vertex AI, the app keeps the access token that it made from your key in memory for about **1 hour** (3500 seconds). A change of the variable does not replace the token until it expires or the page reloads.
- A server or desktop app that runs does not see a variable that you changed after it started. Restart it first (see [Setting the variable](#setting-the-variable)). The page keeps the 5 minutes, not the server. So after a server restart, an open page can use the old value until its 5 minutes run out. If you reopen the desktop app, it starts fresh.
- **A reload of the page clears both times. It also drops the copy of the value that the page keeps in memory.** Reload if you do not want to wait.

## Hide API Keys and the Bot Settings note

**Hide API Keys** is in the Display settings (**Settings → Display & Audio → Others**, see [[Settings Display]]). It masks a key field. But it shows a field whose whole value is a `${NAME}` reference as you typed it, because a reference is not secret. A real key stays masked. A value that only contains a reference, such as `sk-${RISU_X_KEY}`, also stays masked.

The app cannot mask every key field. Fields without masking always show what you typed.

In **Settings → Chat Bot**, on the Model tab, RisuAI shows this note for every provider. It appears below the model selectors and above the provider key fields:

> Instead of a key, you can enter ${NAME}: the name of an environment variable on the machine that runs the desktop app or the Node server. Only names like RISU_OPENAI_KEY are read (RISU_, a name, then _KEY or _TOKEN), unless they are listed in the RISU_ALLOWED_ENV variable on that machine. A web build without the Node server cannot read environment variables.

## Fields that accept a reference

The labels below are the labels that Settings shows. A few fields appear on more than one page. They are the same field, so one reference works in all of them.

### Settings → Chat Bot (Model tab)

See [[Settings Chat Bot]].

| Label | Notes |
|---|---|
| OpenAI API Key | It also serves OpenAI-compatible requests, model lists, and speech to text in the [[Playground]]. |
| Key/Password (under the reverse proxy URL) | The reverse proxy key. |
| Claude API Key | It also serves AWS models. For AWS, the whole `AKID:SECRET:region` text must be one reference. |
| OpenRouter API Key | |
| NanoGPT API Key | |
| Mistral API Key | |
| Cohere API Key | |
| Ollama API Key | |
| NovelList API Key | |
| Mancer API Key | |
| NovelAI Bearer Token | Hide API Keys does not mask it. |
| Horde API Key | |
| GoogleAI API Key | The Imagen image provider also uses it. |
| Vertex Private Key | See [Vertex AI private key](#vertex-ai-private-key). |
| `<model name>` API Key (for example DeepInfra API Key, DeepSeek API Key) | The page shows it when the selected model has its own key. |
| Key/Password for a custom model | In **Settings → Advanced Settings → Custom Models**. The app does not mask it. |

### Settings → Other Bots

See [[Settings Other Bots]].

| Label | Notes |
|---|---|
| OpenAI API Key (image generation, DALL-E) | |
| OpenAI Key (TTS) | The same field as the OpenAI API Key above. See [OpenAI TTS](#safety-behaviour). |
| ElevenLabs API key (TTS) | |
| Huggingface Key (TTS) | |
| fish-speech API Key (TTS) | It also serves its model list. |
| NovelAI API key (TTS) and API Key under Novel AI URL (image generation) | The same field. |
| Stability API Key | |
| Fal.ai API Key | |
| API Key (OpenAI-compatible image) | |
| API Key (WaveSpeed image) | It also serves the WaveSpeed model list. |
| SupaMemory OpenAI Key and the OpenAI API Key for HypaMemory embeddings | The same field. SupaMemory, the HypaMemory V2 summaries, and the HypaMemory embeddings use it. |
| Voyage API Key | The embeddings of Voyage Context 3. |
| Key/Password (custom embedding) | The custom embedding of HypaMemory. It is also on the Playground embedding page. |

### Settings → Language (Translator)

See [[Settings Language]]. The page shows these two fields only when the translator is on and its type is DeepL or DeepL X.

| Label | Notes |
|---|---|
| deepL API Key | |
| deepLX Token | |

### Not supported

- **The OpenAI TTS key of a single character** (you set it on a character): The app never resolves it. A card controls that key and the URL next to it, so the app refuses a reference there. A request that still carries it fails with the "A request still contains..." message below.
- OAuth tokens that the app creates and renews on its own are not keys that the user types. So they take no references.

## Safety behaviour

- **What the app stores.** The app does not write the value to the database, saves, backups, presets, or exports. It writes only the `${NAME}` text.
- **Preset import blanks references.** When you import a bot preset, the app clears a reference in its OpenAI API Key or Proxy Key. This feature does not change the import of character cards.
- **The request log shows the reference, not the value.** This also covers the value inside JSON text and in a URL. The app does **not** replace a resolved value that is shorter than 8 characters. So a very short value can still appear in the log.
- **OpenAI TTS.** A character card chooses the TTS base URL. The app resolves the key of the whole app for OpenAI only when that URL is `https` and the host is exactly `api.openai.com`. For any other host, the request fails with the "is only sent to its own provider" message, and the app reads nothing.
- **Not allowed, not set, and empty look the same.** You cannot find out from the messages which variables exist.

## Error messages

`${NAME}` stands for your reference, for example `${RISU_OPENAI_KEY}`.

| Message | What it means |
|---|---|
| `Environment variable ${NAME} is unavailable: it is not set, the server does not allow it, or the server refused the request.` | The variable is not set, is empty, has a line break, fails the [name rule](#which-variables-can-be-read), or the server refused the call. All of these look the same on purpose. |
| `Environment variable ${NAME} cannot be used here: this platform has no access to the server's environment.` | You are on the pure web build, or on another host with no access to the environment. |
| `Environment variable ${NAME} is only sent to its own provider, so it was not used for this request.` | OpenAI TTS only: The base URL is not the default OpenAI host. |
| `A request still contains the environment variable reference ${NAME}. It was not sent.` | A reference reached a plain request, for example from a plugin or from the own TTS key field of a character. The app stopped the request. |

Vertex AI has two more messages. The app shows them when the Vertex client email or private key is not valid:

- `Invalid Vertex client email. Must include gserviceaccount.com`
- `Invalid Vertex private key. Must include proper key markers.`

Where you see an error depends on the feature:

- **Chat:** The request fails with the message.
- **TTS speech:** An alert. **ElevenLabs voice list:** A red message in the panel. **Fish model list:** An alert, then an empty list.
- **Image generation:** An alert, and the app sends no request.
- **Speech to text (Whisper):** An alert.
- **SupaMemory and HypaMemory V2 summaries:** The error appears as "SupaMemory: " followed by the message.
- **WaveSpeed model list:** An alert. **Ollama cloud model list:** A message in the panel.
- **DeepL and DeepLX:** When the app translates a message, the app shows the error as an alert. Other places that use the translator can show it differently.
- **Dynamic model lists (Google, Anthropic, OpenAI) and the Google tokenizer:** No message. The error goes only to the browser console.

## Moving to or from upstream RisuAI

A `.bin` backup carries the text `${NAME}` as it is. The save format does not change, and no data is lost in either direction.

Upstream RisuAI does not know references. It sends `${NAME}` as the key, and the provider rejects it. If you load such a backup into upstream, enter your keys again there. (This is advice. The app does not do it for you.)

See also [[Migrating from upstream]].

## Plugins

- **V3 plugins cannot resolve references.** They have no way to ask for an environment variable. Their requests go through the own fetch of the app, which never substitutes a reference. It refuses a request in which a header value, or a value in the URL query, is a whole reference. This also applies when the reference follows `Bearer`, `DeepL-Auth-Key`, `Key`, or `Token`. The app does not check a reference inside a request body. V3 plugins also cannot read the key fields that you typed.
- **A V2.1 plugin that is already enabled runs inside the app page. It does not run in a sandbox like V3 plugins.** Only a rewrite on a best-effort basis restricts its code. The app itself describes that rewrite as possibly unsafe. The app does not stop such a plugin from asking the server or desktop app for any variable that passes the name rule. This includes `RISU_..._KEY` variables that you never typed into RisuAI. You can no longer install V2.1 plugins. But one that came in with an upstream backup can still be enabled.

Advice: Keep only the variables that RisuAI needs in the form `RISU_<name>_KEY` or `_TOKEN`, or in `RISU_ALLOWED_ENV`. Do not enable V2.1 plugins on a machine whose environment holds keys that you do not want them to read. See [[Settings Plugins]] and [[Plugin Docs]].

**For plugin authors:** Suppose a plugin sends `Authorization: Bearer ${FOO}` (a whole uppercase reference in a header value or a URL query value). Then `globalFetch` returns a failed result (`ok: false`, status 400, data that starts with `SecretRefError:`), and `fetchNative` rejects. The app sends lowercase or partial `${...}` text unchanged.
