# API Keys from Environment Variables

> **Fork-specific.** This feature exists in this fork only. Upstream RisuAI does not have it. See [Moving to or from upstream RisuAI](#moving-to-or-from-upstream-risuai).

Instead of typing an API key into a settings field, you can type a reference such as `${RISU_OPENAI_KEY}`. When RisuAI needs the key, it reads the environment variable of that name on the machine that runs the Node server or the desktop app.

Why use it:

- The key is not written to your database, backups, presets or exports. Only the reference text is stored.
- You can rotate a key by changing the variable. You do not have to edit RisuAI.
- You can share a backup or a preset without the key going with it.

## What it does not do

Read this before you rely on it.

- **It does not keep the key away from the browser.** The server or desktop app sends the value to the page. The page reuses it for 5 minutes before asking again, but keeps a copy in memory until you reload the page. That copy is what lets the request log show the reference instead of the value.
- **On a shared Node server, anyone who can log in to the server (with the password, or a login the server already trusts) can make it hand over any allowed variable.** "Allowed" means a name that fits the [name rule](#which-variables-can-be-read).
- It does not work in every build. See the next section.

## Where it works

| Build | Works? |
|---|---|
| Desktop app | Yes |
| Node server | Yes |
| Pure web build (no Node server) | No |
| Hono server | No |

Where it does not work, a reference is not replaced. A request that needs it fails with an [error message](#error-messages).

## Syntax

The whole field must be one reference: `${NAME}`.

- `NAME` uses uppercase letters, digits and underscores only. It must start with a letter or an underscore.
- Spaces around the reference are ignored.
- Partial text is **not** a reference. `Bearer ${RISU_X_KEY}` and `sk-${RISU_X_KEY}` are used exactly as typed, as if you had typed a key. Lowercase names such as `${risu_x_key}` are used as typed too.

Example, in the **OpenAI API Key** field of [[Settings Chat Bot]]:

```
${RISU_OPENAI_KEY}
```

## Which variables can be read

A variable can be read only if its name passes one of these two rules. The check is done by the server or the desktop app, not by the page.

1. **The `RISU_` rule.** The name is `RISU_`, then a name of your choice, then `_KEY` or `_TOKEN`.
   - Read: `RISU_OPENAI_KEY`, `RISU_X_TOKEN`.
   - Not read: `RISU_KEY` (nothing between `RISU_` and `_KEY`) and `RISU_OPENAI` (no suffix).
2. **The allow list.** Any other name works if it is listed exactly in a variable called `RISU_ALLOWED_ENV`, separated by commas. Example: `RISU_ALLOWED_ENV=FOO_API,BAR_API`.
   - Spaces around each entry are ignored, and empty entries are skipped.
   - Matching is exact and case-sensitive.
   - Names listed there must still be uppercase letters, digits and underscores.
   - RISU_ALLOWED_ENV itself must be set on the machine that runs the server or the desktop app. The server and the desktop app read it, and the variable you ask for, on each lookup, not at startup.

A name that fails both rules is treated like a variable that is not set. You see the same message in both cases, on purpose, so nobody can use it to find out which variables exist.

## Setting the variable

Set it on the machine that runs the server or the desktop app.

- **Node server:** in the shell that starts it, or in the environment of the service or container that runs it.
- **Desktop app:** in the operating system environment of your user. An app started from a menu, dock or shortcut may not see a variable that you only exported in a terminal.

**Restart after you set or change it.** A program gets its environment when it starts. A variable you set or change afterwards is not seen by a server or app that is already running. Restart the Node server, or fully quit and reopen the desktop app. After a server restart, an open page can still use the old value for a few minutes; see [How long a change takes](#how-long-a-change-takes).

The server does not read a `.env` file. Set a real environment variable.

Examples use `RISU_OPENAI_KEY` and the placeholder value `sk-...`.

### Windows

- **Settings:** search for "Edit environment variables for your account", choose **New** under User variables, and enter the name and value.
- **Terminal:** `setx RISU_OPENAI_KEY "sk-..."`. This affects programs started afterwards, not the terminal you typed it in.
- **One run of the Node server (PowerShell):** `$env:RISU_OPENAI_KEY = "sk-..."`, then start the server in that same window.
- If the desktop app still does not see the variable, sign out and back in.

### macOS

- **Node server:** `export RISU_OPENAI_KEY="sk-..."` in the terminal, then start the server from it. Add the line to `~/.zshrc` to keep it for new terminals.
- **Desktop app:** the RisuAI app opened from Finder or the Dock does not read `~/.zshrc`. Run `launchctl setenv RISU_OPENAI_KEY "sk-..."`, then reopen the app. This lasts until you restart or log out. Or start the app's executable from a terminal where you exported the variable.

### Linux

- **Shell:** `export RISU_OPENAI_KEY="sk-..."`, or add the line to `~/.profile`. An app started from the desktop may need you to log out and back in.
- **Desktop session:** put `RISU_OPENAI_KEY=sk-...` in a file such as `~/.config/environment.d/risu.conf`, then log out and back in.
- **Node server as a systemd service:** add `Environment=RISU_OPENAI_KEY=sk-...` (or `EnvironmentFile=`) to the unit, then run `systemctl daemon-reload` and restart the service.

### Docker

Add an `environment:` entry to the `risutanium` service in `docker-compose.yml`:

```yaml
services:
  risutanium:
    environment:
      RISU_OPENAI_KEY: ${RISU_OPENAI_KEY}
```

Docker Compose fills in `${RISU_OPENAI_KEY}` from your shell, or from a `.env` file next to `docker-compose.yml`. That `.env` is read by Compose, not by RisuAI. You can also write the value directly instead of `${...}`. Then run `docker compose up -d` to recreate the container. With `docker run`, pass `-e RISU_OPENAI_KEY=sk-...`.

A variable set at user level can be read by every program that user runs. That is the normal trade-off.

## Rules for the value

- Spaces at both ends are trimmed.
- An empty value is rejected.
- A value with a line break is rejected.

### Vertex AI private key

A Vertex AI private key (PEM) normally has several lines, so it needs special care:

- Write it on **one line**, with a literal `\n` where each line break would be.
- It must contain the `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` lines. A key marked `BEGIN RSA PRIVATE KEY` is rejected.
- The **Vertex Client Email** must be filled in, and it must contain `gserviceaccount.com`.

## How long a change takes

- RisuAI remembers a resolved value for **5 minutes** per variable. A changed variable can take up to 5 minutes to apply. A failed lookup is not remembered.
- For Vertex AI, the access token made from your key is kept in memory for about **1 hour** (3500 seconds). Changing the variable does not replace the token until it expires or the page reloads.
- A running server or desktop app does not see a variable changed after it started. Restart it first (see [Setting the variable](#setting-the-variable)). The 5 minutes are kept by the page, not the server, so after a server restart an open page can use the old value until its 5 minutes run out. Reopening the desktop app starts fresh.
- **Reloading the page clears both, and also drops the copy of the value that the page keeps in memory.** Reload if you do not want to wait.

## Hide API Keys and the Bot Settings note

**Hide API Keys** is in the Display settings (**Settings → Display & Audio → Others**, see [[Settings Display]]). It masks a key field, but a field whose whole value is a `${NAME}` reference is shown as typed, because a reference is not secret. A real key stays masked. A value that only contains a reference, such as `sk-${RISU_X_KEY}`, also stays masked.

Not every key field can be masked. Fields without masking always show what you typed.

In **Settings → Chat Bot**, on the Model tab, below the model selectors and above the provider key fields, RisuAI shows this note for every provider:

> Instead of a key, you can enter ${NAME}: the name of an environment variable on the machine that runs the desktop app or the Node server. Only names like RISU_OPENAI_KEY are read (RISU_, a name, then _KEY or _TOKEN), unless they are listed in the RISU_ALLOWED_ENV variable on that machine. A web build without the Node server cannot read environment variables.

## Fields that accept a reference

The labels below are the ones shown in Settings. A few fields appear on more than one page. They are the same field, so one reference works in all of them.

### Settings → Chat Bot (Model tab)

See [[Settings Chat Bot]].

| Label | Notes |
|---|---|
| OpenAI API Key | Also used for OpenAI-compatible requests, model lists and speech to text in the [[Playground]]. |
| Key/Password (under the reverse proxy URL) | Reverse proxy key. |
| Claude API Key | Also used for AWS models. For AWS, the whole `AKID:SECRET:region` text must be one reference. |
| OpenRouter API Key | |
| NanoGPT API Key | |
| Mistral API Key | |
| Cohere API Key | |
| Ollama API Key | |
| NovelList API Key | |
| Mancer API Key | |
| NovelAI Bearer Token | Not masked by Hide API Keys. |
| Horde API Key | |
| GoogleAI API Key | Also used by the Imagen image provider. |
| Vertex Private Key | See [Vertex AI private key](#vertex-ai-private-key). |
| `<model name>` API Key (for example DeepInfra API Key, DeepSeek API Key) | Shown when the selected model has its own key. |
| Key/Password for a custom model | In **Settings → Advanced Settings → Custom Models**. Not masked. |

### Settings → Other Bots

See [[Settings Other Bots]].

| Label | Notes |
|---|---|
| OpenAI API Key (image generation, DALL-E) | |
| OpenAI Key (TTS) | Same field as the OpenAI API Key above. See [OpenAI TTS](#safety-behaviour). |
| ElevenLabs API key (TTS) | |
| Huggingface Key (TTS) | |
| fish-speech API Key (TTS) | Also used for its model list. |
| NovelAI API key (TTS) and API Key under Novel AI URL (image generation) | Same field. |
| Stability API Key | |
| Fal.ai API Key | |
| API Key (OpenAI-compatible image) | |
| API Key (WaveSpeed image) | Also used for the WaveSpeed model list. |
| SupaMemory OpenAI Key and the OpenAI API Key for HypaMemory embeddings | Same field. Used by SupaMemory, HypaMemory V2 summaries and the HypaMemory embeddings. |
| Voyage API Key | Voyage Context 3 embeddings. |
| Key/Password (custom embedding) | HypaMemory custom embedding. Also on the Playground embedding page. |

### Settings → Language (Translator)

See [[Settings Language]]. These two fields are shown only when the translator is on and its type is DeepL or DeepL X.

| Label | Notes |
|---|---|
| deepL API Key | |
| deepLX Token | |

### Not supported

- **The per-character OpenAI TTS key** (set on a character) is never resolved. A card controls that key and the URL next to it, so a reference there is refused. A request that still carries it fails with the "A request still contains..." message below.
- OAuth tokens that the app creates and renews on its own are not user-typed keys, so they take no references.

## Safety behaviour

- **What is stored.** The value is not written to the database, saves, backups, presets or exports; only the `${NAME}` text is.
- **Preset import blanks references.** When you import a bot preset, a reference in its OpenAI API Key or Proxy Key is cleared. Character card import is not changed by this feature.
- **The request log shows the reference, not the value.** This also covers the value inside JSON text and in a URL. A resolved value shorter than 8 characters is **not** replaced, so a very short value can still appear in the log.
- **OpenAI TTS.** A character card chooses the TTS base URL. The app-wide OpenAI key is resolved only when that URL is `https` and the host is exactly `api.openai.com`. For any other host the request fails with the "is only sent to its own provider" message and nothing is read.
- **Not allowed, not set and empty look the same.** You cannot find out which variables exist from the messages.

## Error messages

`${NAME}` stands for your reference, for example `${RISU_OPENAI_KEY}`.

| Message | What it means |
|---|---|
| `Environment variable ${NAME} is unavailable: it is not set, the server does not allow it, or the server refused the request.` | The variable is not set, is empty, has a line break, fails the [name rule](#which-variables-can-be-read), or the server refused the call. All of these look the same on purpose. |
| `Environment variable ${NAME} cannot be used here: this platform has no access to the server's environment.` | You are on the pure web build, or another host with no environment access. |
| `Environment variable ${NAME} is only sent to its own provider, so it was not used for this request.` | OpenAI TTS only: the base URL is not the default OpenAI host. |
| `A request still contains the environment variable reference ${NAME}. It was not sent.` | A reference reached a plain request, for example from a plugin or from a character's own TTS key field. The request was stopped. |

Vertex AI has two more messages, shown when the Vertex client email or private key is not valid:

- `Invalid Vertex client email. Must include gserviceaccount.com`
- `Invalid Vertex private key. Must include proper key markers.`

Where you see an error depends on the feature:

- **Chat:** the request fails with the message.
- **TTS speech:** an alert. **ElevenLabs voice list:** a red message in the panel. **Fish model list:** an alert, then an empty list.
- **Image generation:** an alert, and no request is sent.
- **Speech to text (Whisper):** an alert.
- **SupaMemory and HypaMemory V2 summaries:** the error appears as "SupaMemory: " followed by the message.
- **WaveSpeed model list:** an alert. **Ollama cloud model list:** a message in the panel.
- **DeepL and DeepLX:** when the app translates a message, the error is shown as an alert. Other places that use the translator may show it differently.
- **Dynamic model lists (Google, Anthropic, OpenAI) and the Google tokenizer:** no message. The error goes to the browser console only.

## Moving to or from upstream RisuAI

A `.bin` backup carries the text `${NAME}` as it is. The save format does not change, and no data is lost in either direction.

Upstream RisuAI does not know references. It sends `${NAME}` as the key, and the provider rejects it. If you load such a backup into upstream, retype your keys there. (This is advice, not something the app does for you.)

See also [[Migrating from upstream]].

## Plugins

- **V3 plugins cannot resolve references.** They have no way to ask for an environment variable. Their requests go through the app's own fetch, which never substitutes a reference. It refuses a request in which a header value, or a URL query value, is a whole reference. This also applies when the reference follows `Bearer`, `DeepL-Auth-Key`, `Key` or `Token`. A reference inside a request body is not checked. V3 plugins also cannot read your typed key fields.
- **A V2.1 plugin that is already enabled runs inside the app page, not in a sandbox like V3 plugins.** Its code is restricted only by a best-effort rewrite that the app itself describes as possibly unsafe. The app does not stop such a plugin from asking the server or desktop app for any variable that passes the name rule, including `RISU_..._KEY` variables you never typed into RisuAI. V2.1 plugins can no longer be installed, but one that came in with an upstream backup can still be enabled.

Advice: keep only the variables RisuAI needs under the `RISU_<name>_KEY` / `_TOKEN` form or in `RISU_ALLOWED_ENV`. Do not enable V2.1 plugins on a machine whose environment holds keys you do not want them to read. See [[Settings Plugins]] and [[Plugin Docs]].

**For plugin authors:** if a plugin sends `Authorization: Bearer ${FOO}` (a whole uppercase reference in a header value or URL query value), `globalFetch` returns a failed result (`ok: false`, status 400, data starting with `SecretRefError:`) and `fetchNative` rejects. Lowercase or partial `${...}` text is sent unchanged.
